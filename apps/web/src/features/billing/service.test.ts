import { describe, expect, it } from "vitest";
import { eq, schema, type Executor } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { invoiceInput, paymentInput } from "./schemas";
import {
  createInvoice,
  getChecksDueSoon,
  getCustomerAccount,
  getReceivables,
  getReceivablesSummary,
  getRouteCollections,
  getSalesByChannel,
  listChecks,
  registerPayment,
  setCheckStatus,
} from "./service";

const TODAY = "2026-10-02";

async function customer(tx: Executor, legalName: string) {
  return (await tx.query.customers.findFirst({ where: eq(schema.customers.legalName, legalName) }))!;
}

function invoice(customerId: string, over: Record<string, unknown> = {}) {
  return invoiceInput.parse({
    customerId,
    invoiceType: "A",
    pointOfSale: "2",
    number: "9001",
    issueDate: "2026-09-20",
    netTotal: 100000,
    vatTotal: 21000,
    total: 121000,
    ...over,
  });
}

function cashPayment(customerId: string, amount: number, over: Record<string, unknown> = {}) {
  return paymentInput.parse({ customerId, method: "cash", amount, ...over });
}

/** Pedido entregado de un cliente (insert directo: el alta de pedidos es de M1). */
async function deliveredOrder(tx: Executor, customerId: string, total: number) {
  const [o] = await tx
    .insert(schema.orders)
    .values({ customerId, promisedDate: "2026-09-30", status: "delivered", total, deliveredAt: new Date() })
    .returning();
  return o!;
}

describe("cuenta corriente (RF-30)", () => {
  it("La Reina del seed: factura de $468.000 con un cheque de $200.000 deja un saldo de $268.000", async () => {
    await inRollback("nahuel", async (tx) => {
      const reina = await customer(tx, "Supermercado La Reina");
      const acc = (await getCustomerAccount(tx, reina.id, TODAY))!;
      expect(acc.balance).toBe(268000);
      // Vence el 10/10 (emisión + 30 días): hoy no está vencida.
      expect(acc.overdue).toBe(0);
      expect(acc.buckets).toMatchObject({ current: 268000, total: 268000 });
      expect(acc.invoices).toHaveLength(1);
      expect(acc.invoices[0]).toMatchObject({
        label: "Factura A 0002-00001234",
        total: 468000,
        paid: 200000,
        open: 268000,
        dueDate: "2026-10-10",
        state: "current",
        orderNumber: expect.any(Number),
      });
      // Estado de cuenta con saldo acumulado: cargo, luego el cheque.
      expect(acc.statement.map((r) => [r.kind, r.amount, r.balance])).toEqual([
        ["charge", 468000, 468000],
        ["credit", 200000, 268000],
      ]);
      expect(acc.statement[1]!.detail).toContain("45879632");
      // Pasado el vencimiento, la deuda cae en 1–30 días.
      const later = (await getCustomerAccount(tx, reina.id, "2026-10-20"))!;
      expect(later.overdue).toBe(268000);
      expect(later.buckets.d1_30).toBe(268000);
      expect(later.invoices[0]!.state).toBe("overdue");
    });
  });

  it("el cheque rechazado deja de ser crédito y el cliente vuelve a deber", async () => {
    await inRollback("nahuel", async (tx) => {
      const reina = await customer(tx, "Supermercado La Reina");
      const check = await tx.query.checks.findFirst({ where: eq(schema.checks.number, "45879632") });
      await setCheckStatus(tx, { checkId: check!.id, status: "deposited", notes: null });
      expect((await getCustomerAccount(tx, reina.id, TODAY))!.balance).toBe(268000);
      await setCheckStatus(tx, { checkId: check!.id, status: "rejected", notes: "Sin fondos" });
      const acc = (await getCustomerAccount(tx, reina.id, TODAY))!;
      expect(acc.balance).toBe(468000);
      expect(acc.invoices[0]).toMatchObject({ paid: 0, open: 468000 });
      // El cobro rechazado ya no figura como crédito, pero queda avisado.
      expect(acc.statement.map((r) => r.kind)).toEqual(["charge"]);
      expect(acc.rejectedChecks).toEqual([
        expect.objectContaining({ number: "45879632", bank: "Banco Macro", amount: 200000 }),
      ]);
      // Un cheque rechazado es un estado final.
      await expect(setCheckStatus(tx, { checkId: check!.id, status: "cashed", notes: null })).rejects.toThrow(
        /no es válido/,
      );
    });
  });

  it("imputa los cobros por vencimiento (FIFO) y arma los tramos de antigüedad", async () => {
    await inRollback("nahuel", async (tx) => {
      const c = await customer(tx, "La Esperanza"); // contado
      // Hoy 02/10: vencidas hace 52, 22 y a vencer en 8 días.
      await createInvoice(
        tx,
        null,
        invoice(c.id, {
          number: "100",
          issueDate: "2026-08-11",
          total: 100000,
          netTotal: 82644.63,
          vatTotal: 17355.37,
        }),
        TODAY,
      );
      await createInvoice(
        tx,
        null,
        invoice(c.id, {
          number: "101",
          issueDate: "2026-09-10",
          total: 50000,
          netTotal: 41322.31,
          vatTotal: 8677.69,
        }),
        TODAY,
      );
      await createInvoice(
        tx,
        null,
        invoice(c.id, {
          number: "102",
          issueDate: "2026-09-25",
          dueDate: "2026-10-10",
          total: 30000,
          netTotal: 24793.39,
          vatTotal: 5206.61,
        }),
        TODAY,
      );
      await registerPayment(tx, null, cashPayment(c.id, 120000), TODAY);

      const acc = (await getCustomerAccount(tx, c.id, TODAY))!;
      expect(acc.balance).toBe(60000);
      const byNumber = Object.fromEntries(acc.invoices.map((i) => [i.label, i]));
      expect(byNumber["Factura A 0002-00000100"]).toMatchObject({ paid: 100000, open: 0, state: "paid" });
      expect(byNumber["Factura A 0002-00000101"]).toMatchObject({
        paid: 20000,
        open: 30000,
        state: "overdue",
      });
      expect(byNumber["Factura A 0002-00000102"]).toMatchObject({ paid: 0, open: 30000, state: "current" });
      expect(acc.buckets).toMatchObject({ current: 30000, d1_30: 30000, total: 60000 });
      expect(acc.overdue).toBe(30000);

      const r = await getReceivables(tx, TODAY);
      const row = r.rows.find((x) => x.customerId === c.id)!;
      expect(row).toMatchObject({ balance: 60000, overdue: 30000, oldestDueDate: "2026-09-10" });
      // La Reina (268.000) + Esperanza (60.000).
      expect(r.total).toBe(328000);
      expect(r.rows[0]!.customerId).toBe(c.id); // el más vencido primero
    });
  });

  it("los pagos de más quedan como saldo a favor y las notas de crédito restan deuda", async () => {
    await inRollback("nahuel", async (tx) => {
      const c = await customer(tx, "Vía Dolce");
      await createInvoice(
        tx,
        null,
        invoice(c.id, { number: "200", total: 10000, netTotal: 8264.46, vatTotal: 1735.54 }),
        TODAY,
      );
      await createInvoice(
        tx,
        null,
        invoice(c.id, { invoiceType: "NC_A", number: "5", total: 2500, netTotal: 2066.12, vatTotal: 433.88 }),
        TODAY,
      );
      expect((await getCustomerAccount(tx, c.id, TODAY))!.balance).toBe(7500);
      await registerPayment(tx, null, cashPayment(c.id, 9000), TODAY);
      const acc = (await getCustomerAccount(tx, c.id, TODAY))!;
      expect(acc.balance).toBe(-1500);
      expect(acc.buckets.total).toBe(0);
      expect((await getReceivablesSummary(tx, TODAY)).topDebtors.map((d) => d.name)).not.toContain(
        "Vía Dolce",
      );
    });
  });

  it("getReceivablesSummary devuelve total, vencido, antigüedad y principales deudores", async () => {
    await inRollback("nahuel", async (tx) => {
      const c = await customer(tx, "Club Náutico");
      await createInvoice(
        tx,
        null,
        invoice(c.id, {
          number: "300",
          issueDate: "2026-07-01",
          total: 90000,
          netTotal: 74380.99,
          vatTotal: 15619.01,
        }),
        TODAY,
      );
      const s = await getReceivablesSummary(tx, TODAY);
      // Náutico: 7 días de plazo → vence el 08/07, 86 días de mora (61–90).
      expect(s.total).toBe(358000);
      expect(s.overdue).toBe(90000);
      expect(s.buckets).toMatchObject({ current: 268000, d61_90: 90000, total: 358000 });
      expect(s.topDebtors.map((d) => [d.name, d.balance])).toEqual([
        ["Supermercado La Reina", 268000],
        ["Club Náutico", 90000],
      ]);
    });
  });
});

describe("alta de facturas", () => {
  it("el vencimiento por defecto es la emisión más el plazo del cliente", async () => {
    await inRollback("nahuel", async (tx) => {
      const nautico = await customer(tx, "Club Náutico"); // 7 días
      const { invoice: inv } = await createInvoice(
        tx,
        null,
        invoice(nautico.id, { issueDate: "2026-09-20" }),
        TODAY,
      );
      expect(inv.dueDate).toBe("2026-09-27");
      expect(inv).toMatchObject({
        pointOfSale: "0002",
        number: "00009001",
        source: "manual",
        vatTotal: 21000,
      });
      const explicit = await createInvoice(
        tx,
        null,
        invoice(nautico.id, { number: "9002", dueDate: "2026-12-01" }),
        TODAY,
      );
      expect(explicit.invoice.dueDate).toBe("2026-12-01");
    });
  });

  it("rechaza factura duplicada, fecha futura, pedido ajeno o no entregado", async () => {
    await inRollback("nahuel", async (tx) => {
      const c = await customer(tx, "La Esperanza");
      const other = await customer(tx, "Vía Dolce");
      await createInvoice(tx, null, invoice(c.id), TODAY);
      await expect(createInvoice(tx, null, invoice(c.id), TODAY)).rejects.toThrow(/Ya existe la factura/);
      await expect(
        createInvoice(tx, null, invoice(c.id, { number: "9003", issueDate: "2026-10-05" }), TODAY),
      ).rejects.toThrow(/futura/);
      const order = await deliveredOrder(tx, other.id, 121000);
      await expect(
        createInvoice(tx, null, invoice(c.id, { number: "9004", orderId: order.id }), TODAY),
      ).rejects.toThrow(/otro cliente/);
      const pending = await tx.query.orders.findFirst({ where: eq(schema.orders.status, "received") });
      await expect(
        createInvoice(
          tx,
          null,
          invoice(pending!.customerId, { number: "9005", orderId: pending!.id }),
          TODAY,
        ),
      ).rejects.toThrow(/entregado/);
    });
  });

  it("facturar un pedido entregado lo pasa a facturado; el cobro que salda la factura lo pasa a cobrado", async () => {
    await inRollback("nahuel", async (tx) => {
      const c = await customer(tx, "Vía Dolce");
      const order = await deliveredOrder(tx, c.id, 121000);
      await createInvoice(
        tx,
        null,
        invoice(c.id, { number: "400", orderId: order.id, issueDate: "2026-10-01" }),
        TODAY,
      );
      const status = async () =>
        (await tx.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!.status;
      expect(await status()).toBe("invoiced");
      const events = await tx.query.orderEvents.findMany({ where: eq(schema.orderEvents.orderId, order.id) });
      expect(events.map((e) => e.status)).toContain("invoiced");

      // Cobro parcial: sigue facturado.
      const partial = await registerPayment(tx, null, cashPayment(c.id, 100000), TODAY);
      expect(partial.settledOrders).toEqual([]);
      expect(await status()).toBe("invoiced");
      // Cobro que completa la factura: cobrado.
      const full = await registerPayment(tx, null, cashPayment(c.id, 21000), TODAY);
      expect(full.settledOrders).toEqual([order.number]);
      expect(await status()).toBe("paid");
    });
  });

  it("pagar el saldo de La Reina deja el pedido del seed como cobrado", async () => {
    await inRollback("nahuel", async (tx) => {
      const reina = await customer(tx, "Supermercado La Reina");
      const seeded = await tx.query.salesInvoices.findFirst({
        where: eq(schema.salesInvoices.customerId, reina.id),
      });
      expect(
        (await tx.query.orders.findFirst({ where: eq(schema.orders.id, seeded!.orderId!) }))!.status,
      ).toBe("invoiced");
      await registerPayment(tx, null, cashPayment(reina.id, 268000), TODAY);
      expect(
        (await tx.query.orders.findFirst({ where: eq(schema.orders.id, seeded!.orderId!) }))!.status,
      ).toBe("paid");
      expect((await getCustomerAccount(tx, reina.id, TODAY))!.balance).toBe(0);
    });
  });
});

describe("cobros y cheques (RF-31)", () => {
  it("un cobro con varios cheques suma sus importes y los deja en cartera", async () => {
    await inRollback("nahuel", async (tx) => {
      const c = await customer(tx, "Supermercado Arcoiris");
      const p = paymentInput.parse({
        customerId: c.id,
        method: "check",
        checks: [
          {
            bank: "Banco Nación",
            number: "1001",
            amount: 40000,
            cashDate: "2026-10-05",
            issuer: "Arcoiris SA",
          },
          { bank: "Banco Nación", number: "1002", amount: 60000, cashDate: "2026-11-05" },
        ],
      });
      const { payment } = await registerPayment(tx, null, p, TODAY);
      expect(payment.amount).toBe(100000);
      expect(payment.method).toBe("check");
      const checks = await tx.query.checks.findMany({ where: eq(schema.checks.paymentId, payment.id) });
      expect(checks.map((x) => [x.number, x.status]).sort()).toEqual([
        ["1001", "in_portfolio"],
        ["1002", "in_portfolio"],
      ]);
      expect(checks.find((x) => x.number === "1002")!.issuer).toBe("Supermercado Arcoiris");
      // Mismo banco y número: duplicado.
      await expect(
        registerPayment(
          tx,
          null,
          paymentInput.parse({
            customerId: c.id,
            method: "check",
            checks: [{ bank: "banco nación", number: "1001", amount: 1, cashDate: "2026-10-05" }],
          }),
          TODAY,
        ),
      ).rejects.toThrow(/ya está cargado/);
    });
  });

  it("valida el esquema: efectivo necesita importe y solo los cobros con cheque llevan cheques", () => {
    const customerId = "00000000-0000-4000-8000-000000000001";
    expect(paymentInput.safeParse({ customerId, method: "cash" }).success).toBe(false);
    expect(paymentInput.safeParse({ customerId, method: "cash", amount: "1.500,50" }).success).toBe(true);
    expect(paymentInput.safeParse({ customerId, method: "check" }).success).toBe(false);
    expect(
      paymentInput.safeParse({
        customerId,
        method: "transfer",
        amount: 100,
        checks: [{ bank: "BBVA", number: "1", amount: 100, cashDate: "2026-10-05" }],
      }).success,
    ).toBe(false);
  });

  it("la cartera se ordena por fecha de cobro y marca los cheques a cobrar en 7 días", async () => {
    await inRollback("nahuel", async (tx) => {
      const c = await customer(tx, "Supermercado Arcoiris");
      await registerPayment(
        tx,
        null,
        paymentInput.parse({
          customerId: c.id,
          method: "check",
          checks: [
            { bank: "Macro", number: "A3", amount: 30000, cashDate: "2026-10-30" },
            { bank: "Macro", number: "A1", amount: 10000, cashDate: "2026-10-04" },
            { bank: "Macro", number: "A0", amount: 5000, cashDate: "2026-09-28" },
          ],
        }),
        TODAY,
      );
      const pf = await listChecks(tx, {}, TODAY);
      expect(pf.rows.map((r) => r.number)).toEqual(["A0", "A1", "45879632", "A3"]);
      const byNum = Object.fromEntries(pf.rows.map((r) => [r.number, r]));
      expect(byNum.A1).toMatchObject({ dueSoon: true, daysToCash: 2 });
      expect(byNum.A0).toMatchObject({ dueSoon: false, readyToDeposit: true });
      expect(byNum["45879632"]!.dueSoon).toBe(false); // 10/10 = +8 días
      expect(pf.totals).toMatchObject({
        dueSoon: 10000,
        dueSoonCount: 1,
        readyToDeposit: 5000,
        inPortfolio: 245000,
      });
      expect((await getChecksDueSoon(tx, TODAY)).map((x) => x.number)).toEqual(["A1"]);
      expect((await getChecksDueSoon(tx, "2026-10-05")).map((x) => x.number)).toEqual(["45879632"]);

      // Depositado/cobrado salen de "cartera" pero siguen en la lista según el filtro.
      const a1 = byNum.A1!;
      await setCheckStatus(tx, { checkId: a1.id, status: "deposited", notes: null });
      await setCheckStatus(tx, { checkId: a1.id, status: "cashed", notes: null });
      expect((await listChecks(tx, { scope: "active" }, TODAY)).rows.map((r) => r.number)).not.toContain(
        "A1",
      );
      expect((await listChecks(tx, { scope: "cashed" }, TODAY)).rows.map((r) => r.number)).toEqual(["A1"]);
      expect((await listChecks(tx, { scope: "all" }, TODAY)).rows).toHaveLength(4);
    });
  });
});

describe("pantalla de ruta (RF-31)", () => {
  it("lista los clientes de las paradas con su saldo y guarda la ruta en el cobro", async () => {
    await inRollback("nahuel", async (tx) => {
      const reina = await customer(tx, "Supermercado La Reina");
      const dolce = await customer(tx, "Vía Dolce");
      const order = await deliveredOrder(tx, dolce.id, 50000);
      const [route] = await tx.insert(schema.routes).values({ date: TODAY }).returning();
      await tx.insert(schema.routeStops).values([
        { routeId: route!.id, seq: 1, kind: "delivery", customerId: reina.id },
        { routeId: route!.id, seq: 2, kind: "delivery", orderId: order.id },
        { routeId: route!.id, seq: 3, kind: "supplier_pickup" },
      ]);
      const before = (await getRouteCollections(tx, route!.id, TODAY))!;
      expect(before.stops.map((s) => [s.legalName, s.balance])).toEqual([
        ["Supermercado La Reina", 268000],
        ["Vía Dolce", 0],
      ]);

      await registerPayment(tx, null, cashPayment(reina.id, 50000, { routeId: route!.id }), TODAY);
      const after = (await getRouteCollections(tx, route!.id, TODAY))!;
      expect(after.stops[0]).toMatchObject({ balance: 218000, collectedOnRoute: 50000 });
      expect(after.collectedTotal).toBe(50000);
      expect(after.collectedByMethod).toEqual({ cash: 50000 });
      expect(after.payments[0]!.routeId).toBe(route!.id);
      expect(await getRouteCollections(tx, "00000000-0000-4000-8000-000000000000", TODAY)).toBeNull();
    });
  });
});

describe("ventas por canal (para el tablero)", () => {
  it("agrupa las facturas emitidas del mes por canal del cliente; las notas de crédito restan", async () => {
    await inRollback("nahuel", async (tx) => {
      const sept = await getSalesByChannel(tx, "2026-09");
      expect(sept.byChannel.supermarket).toMatchObject({ total: 468000, documents: 1 });
      expect(sept.byChannel.supermarket!.net).toBeCloseTo(386776.86, 2);

      const esperanza = await customer(tx, "La Esperanza");
      await createInvoice(
        tx,
        null,
        invoice(esperanza.id, { number: "700", issueDate: "2026-09-15", total: 121000 }),
        TODAY,
      );
      await createInvoice(
        tx,
        null,
        invoice(esperanza.id, {
          invoiceType: "NC_A",
          number: "7",
          issueDate: "2026-09-16",
          total: 12100,
          netTotal: 10000,
          vatTotal: 2100,
        }),
        TODAY,
      );
      const after = await getSalesByChannel(tx, "2026-09");
      expect(after.byChannel.reseller).toMatchObject({ total: 108900, net: 90000, documents: 2 });
      expect(after.total).toBe(576900);
      // Otro mes: sin ventas.
      expect((await getSalesByChannel(tx, "2026-08")).byChannel).toEqual({});
    });
  });
});
