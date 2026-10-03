import { describe, expect, it } from "vitest";
import { eq, schema, type Tx } from "@chipa/db";
import { ingredientTotals } from "@/features/stock/ledger";
import { inRollback } from "../../../tests/helpers";
import { MockInvoiceExtractor } from "./ai/mock-extractor";
import { invoiceInput, purchaseOrderInput, receptionInput, supplierPaymentInput } from "./schemas";
import {
  changeOrderStatus,
  checkInvoice,
  confirmInvoice,
  createDraftFromExtraction,
  createDraftWithFileOnly,
  createManualDraft,
  createOrder,
  createReception,
  createSupplierFromDraft,
  deleteDraftInvoice,
  expectedDeliveries,
  getInvoice,
  getLatestPrices,
  getSupplierAccount,
  ingredientPriceHistory,
  listInvoices,
  listSupplierBalances,
  monthlySpend,
  priceOverview,
  receptionFormData,
  registerSupplierPayment,
  saveInvoice,
  spendByMonth,
  suggestIngredients,
  updateOrder,
  type InvoiceDetail,
} from "./service";

const TODAY = "2026-10-02";

async function ids(tx: Tx) {
  const ing = await tx.query.ingredients.findMany();
  const sup = await tx.query.suppliers.findMany();
  const loc = await tx.query.locations.findMany();
  const I = Object.fromEntries(ing.map((i) => [i.name, i.id]));
  const S = Object.fromEntries(sup.map((s) => [s.legalName, s.id]));
  const L = Object.fromEntries(loc.map((l) => [l.code, l.id]));
  return {
    barra: I["Queso barra (Tybo/Maki)"]!,
    reggianito: I["Queso reggianito"]!,
    fecula: I["Fécula de mandioca"]!,
    leche: I["Leche"]!,
    leo: S["Leo Pelle"]!,
    cotar: S["Cotar"]!,
    heladera: L["HELADERA"]!,
    seco: L["DEP-SECO"]!,
  };
}

/** Borrador (cargado con el extractor simulado) → datos del formulario de revisión. */
function toFormInput(inv: InvoiceDetail) {
  return invoiceInput.parse({
    id: inv.id,
    supplierId: inv.supplierId,
    invoiceType: inv.invoiceType,
    pointOfSale: inv.pointOfSale,
    number: inv.number,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    otherTaxes: inv.otherTaxes,
    declaredNet: inv.netTotal,
    declaredVat: inv.vatTotal,
    declaredTotal: inv.total,
    notes: inv.notes,
    items: inv.items.map((i) => ({
      description: i.description,
      ingredientId: i.ingredientId,
      qty: i.qty,
      unit: i.unit,
      unitPriceNet: i.unitPriceNet,
      vatRate: i.vatRate,
      vatAmount: i.vatAmount,
    })),
  });
}

async function mockDraft(tx: Tx) {
  const extraction = await new MockInvoiceExtractor().extract();
  const draft = await createDraftFromExtraction(tx, { extraction, fileKey: "invoices/test.png" });
  return (await getInvoice(tx, draft.id))!;
}

describe("factura por IA → borrador (RF-08)", () => {
  it("crea el borrador con proveedor por nombre, líneas mapeadas y la respuesta cruda", async () => {
    await inRollback("nahuel", async (tx) => {
      const x = await ids(tx);
      const inv = await mockDraft(tx);
      expect(inv).toMatchObject({
        status: "draft",
        source: "ai",
        fileKey: "invoices/test.png",
        supplierId: x.leo,
        invoiceType: "A",
        pointOfSale: "0003",
        number: "00004567",
        issueDate: "2026-10-01",
        netTotal: 950500,
        vatTotal: 171412.5,
        otherTaxes: 9505,
        total: 1131417.5,
      });
      expect(inv.items.map((i) => i.ingredientId)).toEqual([x.barra, x.reggianito, x.fecula]);
      expect(inv.items.map((i) => i.vatRate)).toEqual([21, 21, 10.5]);
      expect(inv.items.map((i) => i.lineTotal)).toEqual([491260, 333960, 296692.5]);
      const ai = inv.aiExtraction as {
        provider: string;
        raw: { number: string };
        extracted: { supplierName: string };
      };
      expect(ai.provider).toBe("mock");
      expect(ai.raw.number).toBe("00004567");
      expect(ai.extracted.supplierName).toBe("LEO PELLE");
    });
  });

  it("rechaza una factura duplicada (proveedor + tipo + punto de venta + número)", async () => {
    await inRollback("nahuel", async (tx) => {
      const first = await mockDraft(tx);
      await confirmInvoice(tx, toFormInput(first));
      const extraction = await new MockInvoiceExtractor().extract();
      await expect(createDraftFromExtraction(tx, { extraction, fileKey: null })).rejects.toThrow(
        /Ya está cargada la factura A 0003-00004567 de Leo Pelle/,
      );
    });
  });

  it("también detecta el duplicado al editar un borrador", async () => {
    await inRollback("nahuel", async (tx) => {
      const x = await ids(tx);
      const first = await mockDraft(tx);
      await confirmInvoice(tx, toFormInput(first));
      const manual = await createManualDraft(tx);
      const input = invoiceInput.parse({
        ...toFormInput(first),
        id: manual.id,
        supplierId: x.leo,
      });
      await expect(saveInvoice(tx, input)).rejects.toThrow(/Ya está cargada/);
    });
  });

  it("si la IA falla queda un borrador con la foto para completarlo a mano", async () => {
    await inRollback("nahuel", async (tx) => {
      const d = await createDraftWithFileOnly(tx, "invoices/x.jpg", "servicio caído");
      const inv = (await getInvoice(tx, d.id))!;
      expect(inv).toMatchObject({ source: "ai", status: "draft", fileKey: "invoices/x.jpg", items: [] });
      expect(inv.aiExtraction).toEqual({ error: "servicio caído" });
    });
  });

  it("sugiere insumos por historial del proveedor y por similitud de nombre", async () => {
    await inRollback("nahuel", async (tx) => {
      const x = await ids(tx);
      expect(await suggestIngredients(tx, x.leo, ["QUESO REGGIANITO X KG", "Flete"])).toEqual([
        x.reggianito,
        null,
      ]);
      // Historial: tras confirmar con un mapeo manual, la misma descripción vuelve al mismo insumo.
      const draft = await createManualDraft(tx);
      await saveInvoice(
        tx,
        invoiceInput.parse({
          id: draft.id,
          supplierId: x.leo,
          invoiceType: "A",
          pointOfSale: "1",
          number: "10",
          issueDate: "2026-10-01",
          items: [
            {
              description: "ART 77 ESPECIAL",
              ingredientId: x.fecula,
              qty: 10,
              unit: "kg",
              unitPriceNet: 1700,
              vatRate: 21,
            },
          ],
        }),
      );
      await confirmInvoice(
        tx,
        invoiceInput.parse({
          ...toFormInput((await getInvoice(tx, draft.id))!),
        }),
      );
      expect(await suggestIngredients(tx, x.leo, ["art 77 especial"])).toEqual([x.fecula]);
      expect(await suggestIngredients(tx, x.cotar, ["art 77 especial"])).toEqual([null]);
    });
  });
});

describe("confirmación (Regla 11 y RF-09)", () => {
  it("confirma, deja el historial de precios y completa el CUIT del proveedor", async () => {
    await inRollback("nahuel", async (tx) => {
      const x = await ids(tx);
      const inv = await mockDraft(tx);
      const result = await confirmInvoice(tx, toFormInput(inv));
      expect(result).toMatchObject({ pricesRecorded: 3, unmappedLines: 0, differences: [] });

      const confirmed = (await getInvoice(tx, inv.id))!;
      expect(confirmed.status).toBe("confirmed");
      expect(confirmed.dueDate).toBe("2026-10-31");

      const latest = await getLatestPrices(tx);
      expect(latest[x.barra]).toMatchObject({ unitPriceNet: 10150, date: "2026-10-01", supplierId: x.leo });
      expect(latest[x.reggianito]!.unitPriceNet).toBe(13800);
      expect(latest[x.fecula]!.unitPriceNet).toBe(1790);
      // un insumo sin compras nuevas conserva su último precio del seed
      expect(latest[x.leche]!.unitPriceNet).toBe(1066);

      const leo = await tx.query.suppliers.findFirst({ where: eq(schema.suppliers.id, x.leo) });
      expect(leo!.cuit).toBe("30712345671");
    });
  });

  it("usa el IVA de la factura aunque difiera del calculado, y muestra las diferencias", async () => {
    await inRollback("nahuel", async (tx) => {
      const inv = await mockDraft(tx);
      const input = toFormInput(inv);
      // El IVA de la factura de la fécula es 28.192,50 (10,5 % de 268.500 = 28.192,50). Lo cambiamos:
      input.items[2]!.vatAmount = 28000;
      const check = checkInvoice(input);
      expect(check.ok).toBe(false);
      expect(check.diffs.map((d) => d.field)).toEqual(["vat", "total"]);
      await expect(confirmInvoice(tx, input)).rejects.toThrow(/Los totales no coinciden/);
      // con aceptación explícita se confirma y el IVA queda como figura en la factura
      const result = await confirmInvoice(tx, { ...input, acceptDifferences: true });
      expect(result.differences).toHaveLength(2);
      const saved = (await getInvoice(tx, inv.id))!;
      expect(saved.items[2]!.vatAmount).toBe(28000);
      expect(saved.vatTotal).toBe(171412.5); // el total de la factura, no el recalculado
    });
  });

  it("exige proveedor, número y unidades coherentes con el insumo", async () => {
    await inRollback("nahuel", async (tx) => {
      const x = await ids(tx);
      const inv = await mockDraft(tx);
      const base = toFormInput(inv);
      await expect(confirmInvoice(tx, { ...base, supplierId: null })).rejects.toThrow(/Elegí el proveedor/);
      await expect(confirmInvoice(tx, { ...base, number: null })).rejects.toThrow(
        /punto de venta y el número/,
      );
      await expect(confirmInvoice(tx, { ...base, items: [] })).rejects.toThrow(/no tiene líneas/);
      const wrongUnit = structuredClone(base);
      wrongUnit.items[0]!.unit = "unit";
      await expect(confirmInvoice(tx, wrongUnit)).rejects.toThrow(/se maneja en kg/);
      const noQty = structuredClone(base);
      noQty.items[1]!.qty = 0;
      await expect(confirmInvoice(tx, noQty)).rejects.toThrow(/línea 2 no tiene cantidad/);
      expect(x.barra).toBeTruthy();
    });
  });

  it("las líneas sin insumo (p. ej. flete) no generan precios y una confirmada no se edita", async () => {
    await inRollback("nahuel", async (tx) => {
      const x = await ids(tx);
      const draft = await createManualDraft(tx);
      const input = invoiceInput.parse({
        id: draft.id,
        supplierId: x.leo,
        invoiceType: "A",
        pointOfSale: "2",
        number: "99",
        issueDate: "2026-10-01",
        items: [
          {
            description: "Fécula",
            ingredientId: x.fecula,
            qty: 10,
            unit: "kg",
            unitPriceNet: "1.790,50",
            vatRate: "10,5",
          },
          { description: "Flete", qty: 1, unitPriceNet: 5000, vatRate: 21 },
        ],
      });
      const result = await confirmInvoice(tx, input);
      expect(result).toMatchObject({ pricesRecorded: 1, unmappedLines: 1 });
      const inv = (await getInvoice(tx, draft.id))!;
      // totales declarados vacíos → se toman los calculados: 17.905 + 5.000 + IVA 1.880,03 + 1.050
      expect(inv.netTotal).toBe(22905);
      expect(inv.vatTotal).toBe(2930.03);
      await expect(saveInvoice(tx, input)).rejects.toThrow(/ya está confirmada/);
      await expect(deleteDraftInvoice(tx, draft.id)).rejects.toThrow(/ya está confirmada/);
    });
  });

  it("una nota de crédito no pisa el historial de precios", async () => {
    await inRollback("nahuel", async (tx) => {
      const x = await ids(tx);
      const draft = await createManualDraft(tx);
      await confirmInvoice(
        tx,
        invoiceInput.parse({
          id: draft.id,
          supplierId: x.leo,
          invoiceType: "NC_A",
          pointOfSale: "3",
          number: "5",
          issueDate: "2026-10-01",
          items: [
            {
              description: "Fécula",
              ingredientId: x.fecula,
              qty: 1,
              unit: "kg",
              unitPriceNet: 99999,
              vatRate: 21,
            },
          ],
        }),
      );
      expect((await getLatestPrices(tx))[x.fecula]!.unitPriceNet).toBe(1728);
    });
  });

  it("borra borradores y da de alta el proveedor desde la factura leída", async () => {
    await inRollback("nahuel", async (tx) => {
      const extraction = await new MockInvoiceExtractor().extract();
      extraction.supplierName = "Distribuidora Nueva SRL";
      extraction.supplierCuit = "30712345671";
      const d = await createDraftFromExtraction(tx, { extraction, fileKey: null });
      expect(d.supplierId).toBeNull();
      const supplier = await createSupplierFromDraft(tx, d.id);
      expect(supplier).toMatchObject({ legalName: "Distribuidora Nueva SRL", cuit: "30712345671" });
      expect((await getInvoice(tx, d.id))!.supplierId).toBe(supplier.id);
      // si el CUIT ya existe se reutiliza el proveedor
      const again = await createDraftFromExtraction(tx, {
        extraction: { ...extraction, number: "00000001" },
        fileKey: null,
      });
      expect(again.supplierId).toBe(supplier.id);
      await deleteDraftInvoice(tx, d.id);
      expect(await getInvoice(tx, d.id)).toBeNull();
      expect((await listInvoices(tx, { status: "draft" })).map((i) => i.id)).toEqual([again.id]);
    });
  });
});

describe("historial de precios (RF-09)", () => {
  it("muestra compras, variación vs la anterior, comparación entre proveedores y serie mensual", async () => {
    await inRollback("nahuel", async (tx) => {
      const x = await ids(tx);
      const inv = await mockDraft(tx);
      await confirmInvoice(tx, toFormInput(inv));
      // otro proveedor de queso barra, más barato
      const draft = await createManualDraft(tx);
      await confirmInvoice(
        tx,
        invoiceInput.parse({
          id: draft.id,
          supplierId: x.cotar,
          invoiceType: "A",
          pointOfSale: "1",
          number: "1",
          issueDate: "2026-10-02",
          items: [
            {
              description: "Queso barra",
              ingredientId: x.barra,
              qty: 10,
              unit: "kg",
              unitPriceNet: 9500,
              vatRate: 21,
            },
          ],
        }),
      );
      const h = (await ingredientPriceHistory(tx, x.barra))!;
      expect(h.history.map((r) => [r.supplierName, r.date, r.unitPriceNet])).toEqual([
        ["Cotar", "2026-10-02", 9500],
        ["Leo Pelle", "2026-10-01", 10150],
        ["Leo Pelle", "2026-09-29", 9880],
      ]);
      // variación de Leo Pelle vs su compra anterior: 9880 → 10150
      expect(h.history[1]!.variationPct).toBe(2.73);
      expect(h.history[0]!.variationPct).toBeNull();
      expect(h.suppliers.map((s) => [s.name, s.lastPrice, s.vsCheapestPct])).toEqual([
        ["Cotar", 9500, 0],
        ["Leo Pelle", 10150, 6.84],
      ]);
      // mensual: septiembre 9880, octubre → último precio del mes (Cotar 9500)
      expect(h.monthly).toEqual([
        { month: "2026-09", price: 9880, variationPct: null },
        { month: "2026-10", price: 9500, variationPct: -3.85 },
      ]);
      const overview = (await priceOverview(tx)).find((r) => r.ingredientId === x.barra)!;
      expect(overview).toMatchObject({ lastPrice: 9500, suppliers: 2, supplierName: "Cotar" });
      expect(await ingredientPriceHistory(tx, "00000000-0000-0000-0000-000000000000")).toBeNull();
    });
  });
});

describe("órdenes de compra (RF-10)", () => {
  it("numera OC-0001, OC-0002…, completa precio estimado y fecha esperada", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const x = await ids(tx);
      const input = purchaseOrderInput.parse({
        supplierId: x.leo,
        orderedAt: TODAY,
        items: [
          { ingredientId: x.barra, qty: 25 },
          { ingredientId: x.fecula, qty: 150, estimatedUnitPrice: "1.800" },
        ],
      });
      const a = await createOrder(tx, userId, input);
      const b = await createOrder(tx, userId, input);
      expect([a.number, b.number]).toEqual(["OC-0001", "OC-0002"]);
      expect(a).toMatchObject({ status: "draft", responsibleId: userId, expectedAt: "2026-10-04" }); // plazo Leo Pelle: 2 días
      const items = await tx.query.purchaseOrderItems.findMany({
        where: eq(schema.purchaseOrderItems.purchaseOrderId, a.id),
      });
      const byIng = Object.fromEntries(items.map((i) => [i.ingredientId, i]));
      expect(byIng[x.barra]).toMatchObject({ estimatedUnitPrice: 9880, unit: "kg" }); // último precio
      expect(byIng[x.fecula]).toMatchObject({ estimatedUnitPrice: 1800 });
    });
  });

  it("estados: borrador → enviada → cancelada; editar solo en borrador", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const x = await ids(tx);
      const input = purchaseOrderInput.parse({
        supplierId: x.leo,
        orderedAt: TODAY,
        expectedAt: "2026-10-05",
        items: [{ ingredientId: x.barra, qty: 25 }],
      });
      const o = await createOrder(tx, userId, input);
      await updateOrder(tx, o.id, {
        ...input,
        items: [{ ingredientId: x.barra, qty: 30, estimatedUnitPrice: null }],
      });
      expect((await changeOrderStatus(tx, o.id, "sent")).status).toBe("sent");
      await expect(updateOrder(tx, o.id, input)).rejects.toThrow(/borrador/);
      expect((await changeOrderStatus(tx, o.id, "cancelled")).status).toBe("cancelled");
      await expect(changeOrderStatus(tx, o.id, "sent")).rejects.toThrow(/cancelada/);
    });
  });

  it("lista entregas esperadas: atrasadas y próximas, sin borradores ni canceladas", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const x = await ids(tx);
      const mk = async (expectedAt: string, sent: boolean) => {
        const o = await createOrder(
          tx,
          userId,
          purchaseOrderInput.parse({
            supplierId: x.leo,
            orderedAt: "2026-09-28",
            expectedAt,
            items: [{ ingredientId: x.barra, qty: 5 }],
          }),
        );
        if (sent) await changeOrderStatus(tx, o.id, "sent");
        return o;
      };
      const late = await mk("2026-09-30", true);
      const soon = await mk("2026-10-06", true);
      await mk("2026-10-03", false);
      const list = await expectedDeliveries(tx, TODAY);
      expect(list.map((d) => [d.order.id, d.timing.state, d.timing.days])).toEqual([
        [late.id, "overdue", 2],
        [soon.id, "upcoming", 4],
      ]);
    });
  });
});

describe("recepción (RF-11)", () => {
  async function sentOrder(tx: Tx, userId: string, qtys: { barra: number; fecula: number }) {
    const x = await ids(tx);
    const o = await createOrder(
      tx,
      userId,
      purchaseOrderInput.parse({
        supplierId: x.leo,
        orderedAt: "2026-10-01",
        expectedAt: "2026-10-02",
        items: [
          { ingredientId: x.barra, qty: qtys.barra },
          { ingredientId: x.fecula, qty: qtys.fecula },
        ],
      }),
    );
    await changeOrderStatus(tx, o.id, "sent");
    return { order: o, x };
  }

  it("crea recepción, lotes y movimientos de entrada; la OC pasa a parcial y luego a recibida", async () => {
    await inRollback("af", async (tx, userId) => {
      const { order, x } = await sentOrder(tx, userId, { barra: 40, fecula: 150 });
      const before = await ingredientTotals(tx);

      const first = await createReception(
        tx,
        userId,
        receptionInput.parse({
          supplierId: x.leo,
          purchaseOrderId: order.id,
          deliveryNote: "R-0001-00001234",
          lines: [
            {
              ingredientId: x.barra,
              qty: 40,
              supplierLotCode: "TYBO-1002",
              expiryDate: "2026-12-15",
              temperatureC: "3,5",
              locationId: x.heladera,
            },
            { ingredientId: x.fecula, qty: 100, supplierLotCode: "FEC-2610", locationId: x.seco },
          ],
        }),
      );
      expect(first).toMatchObject({ lots: 2, alerts: [], orderStatus: "partially_received" });

      const after = await ingredientTotals(tx);
      expect(after[x.barra]! - before[x.barra]!).toBe(40);
      expect(after[x.fecula]! - before[x.fecula]!).toBe(100);

      const lots = await tx.query.rawLots.findMany({ where: eq(schema.rawLots.receptionId, first.id) });
      expect(lots.find((l) => l.ingredientId === x.barra)).toMatchObject({
        supplierLotCode: "TYBO-1002",
        expiryDate: "2026-12-15",
        temperatureC: 3.5,
        supplierId: x.leo,
        locationId: x.heladera,
      });
      const moves = await tx.query.stockMovements.findMany({
        where: eq(schema.stockMovements.refId, first.id),
      });
      expect(moves).toHaveLength(2);
      expect(moves.every((m) => m.type === "receipt" && m.refTable === "receptions" && m.qty > 0)).toBe(true);

      // el formulario ofrece lo pendiente: 50 kg de fécula
      const form = await receptionFormData(tx, order.id);
      expect(form.order!.lines).toEqual([
        { ingredientId: x.fecula, ordered: 150, received: 100, pending: 50 },
      ]);

      const second = await createReception(
        tx,
        userId,
        receptionInput.parse({
          supplierId: x.leo,
          purchaseOrderId: order.id,
          lines: [{ ingredientId: x.fecula, qty: 50, supplierLotCode: "FEC-2611", locationId: x.seco }],
        }),
      );
      expect(second.orderStatus).toBe("received");
      expect(
        (await tx.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, order.id) }))!.status,
      ).toBe("received");
      await expect(
        createReception(
          tx,
          userId,
          receptionInput.parse({
            supplierId: x.leo,
            purchaseOrderId: order.id,
            lines: [{ ingredientId: x.fecula, qty: 1, supplierLotCode: "X", locationId: x.seco }],
          }),
        ),
      ).rejects.toThrow(/ya fue recibida/);
    });
  });

  it("exige temperatura, vencimiento y lote; alerta si pasa de 5 °C; ignora líneas en 0", async () => {
    await inRollback("af", async (tx, userId) => {
      const x = await ids(tx);
      const line = {
        ingredientId: x.barra,
        qty: 10,
        supplierLotCode: "L1",
        expiryDate: "2026-12-01",
        temperatureC: 4,
        locationId: x.heladera,
      };
      const rec = (lines: object[]) => receptionInput.parse({ supplierId: x.leo, lines });

      await expect(createReception(tx, userId, rec([{ ...line, temperatureC: null }]))).rejects.toThrow(
        /temperatura es obligatoria/,
      );
      await expect(createReception(tx, userId, rec([{ ...line, expiryDate: null }]))).rejects.toThrow(
        /vencimiento es obligatorio/,
      );
      await expect(createReception(tx, userId, rec([{ ...line, supplierLotCode: "" }]))).rejects.toThrow(
        /falta el lote/,
      );
      await expect(createReception(tx, userId, rec([{ ...line, qty: 0 }]))).rejects.toThrow(
        /al menos un insumo/,
      );

      const ok = await createReception(
        tx,
        userId,
        rec([
          { ...line, temperatureC: 8.5 },
          { ...line, ingredientId: x.fecula, qty: 0, locationId: x.seco },
        ]),
      );
      expect(ok.lots).toBe(1); // la línea de fécula en 0 no llegó
      expect(ok.alerts).toEqual([{ ingredient: "Queso barra (Tybo/Maki)", temperatureC: 8.5 }]);
    });
  });

  it("recepción libre (sin OC) y validaciones de la orden", async () => {
    await inRollback("af", async (tx, userId) => {
      const { order, x } = await sentOrder(tx, userId, { barra: 5, fecula: 5 });
      const free = await createReception(
        tx,
        userId,
        receptionInput.parse({
          supplierId: x.cotar,
          lines: [
            {
              ingredientId: x.leche,
              qty: 60,
              supplierLotCode: "LEC-1",
              expiryDate: "2026-10-10",
              temperatureC: 4,
              locationId: x.heladera,
            },
          ],
        }),
      );
      expect(free.orderStatus).toBeNull();
      await expect(
        createReception(
          tx,
          userId,
          receptionInput.parse({
            supplierId: x.cotar,
            purchaseOrderId: order.id,
            lines: [
              {
                ingredientId: x.leche,
                qty: 1,
                supplierLotCode: "L",
                expiryDate: "2026-10-10",
                temperatureC: 4,
                locationId: x.heladera,
              },
            ],
          }),
        ),
      ).rejects.toThrow(/otro proveedor/);
      await changeOrderStatus(tx, order.id, "cancelled");
      await expect(
        createReception(
          tx,
          userId,
          receptionInput.parse({
            supplierId: x.leo,
            purchaseOrderId: order.id,
            lines: [{ ingredientId: x.fecula, qty: 1, supplierLotCode: "L", locationId: x.seco }],
          }),
        ),
      ).rejects.toThrow(/cancelada/);
    });
  });
});

describe("cuenta corriente con proveedores (RF-12)", () => {
  it("saldo, estado de cuenta con saldo acumulado, antigüedad y pagos", async () => {
    await inRollback("nahuel", async (tx) => {
      const x = await ids(tx);
      // Factura de la IA (1.131.417,50 vence 31/10) + una vieja vencida
      await confirmInvoice(tx, toFormInput(await mockDraft(tx)));
      const old = await createManualDraft(tx);
      await confirmInvoice(
        tx,
        invoiceInput.parse({
          id: old.id,
          supplierId: x.leo,
          invoiceType: "A",
          pointOfSale: "3",
          number: "100",
          issueDate: "2026-08-01",
          dueDate: "2026-08-31",
          items: [{ description: "Sal", qty: 100, unit: "kg", unitPriceNet: 700, vatRate: 21 }],
        }),
      );
      let acc = await getSupplierAccount(tx, x.leo, TODAY);
      expect(acc.balance).toBe(1131417.5 + 84700);
      expect(acc.aging).toMatchObject({ current: 1131417.5, d31_60: 84700, total: 1216117.5 });
      expect(acc.statement.map((r) => [r.date, r.kind, r.amount, r.balance])).toEqual([
        ["2026-08-01", "charge", 84700, 84700],
        ["2026-10-01", "charge", 1131417.5, 1216117.5],
      ]);
      expect(acc.statement[1]!.label).toBe("Factura A 0003-00004567");

      // Pago de 100.000: se imputa a la factura más vieja (FIFO por vencimiento)
      await registerSupplierPayment(
        tx,
        supplierPaymentInput.parse({
          supplierId: x.leo,
          date: "2026-10-02",
          amount: "100.000",
          method: "transfer",
          reference: "Op 123",
        }),
      );
      acc = await getSupplierAccount(tx, x.leo, TODAY);
      expect(acc.balance).toBe(1116117.5);
      expect(acc.statement.at(-1)).toMatchObject({
        kind: "credit",
        amount: 100000,
        balance: 1116117.5,
        label: "Pago (Transferencia) · Op 123",
      });
      expect(acc.openCharges).toEqual([
        {
          id: expect.any(String),
          label: "Factura A 0003-00004567",
          dueDate: "2026-10-31",
          open: 1116117.5,
          overdue: false,
        },
      ]);
      expect(acc.aging).toMatchObject({ current: 1116117.5, d31_60: 0 });

      const balances = await listSupplierBalances(tx, TODAY);
      expect(balances).toHaveLength(1);
      expect(balances[0]).toMatchObject({ name: "Leo Pelle", balance: 1116117.5, overdue: 0 });
    });
  });

  it("vencimiento = fecha de la factura o emisión + plazo del proveedor; las notas de crédito restan", async () => {
    await inRollback("nahuel", async (tx) => {
      const x = await ids(tx);
      await tx.update(schema.suppliers).set({ paymentTermsDays: 15 }).where(eq(schema.suppliers.id, x.cotar));
      const mk = async (type: "A" | "NC_A", number: string, price: number) => {
        const d = await createManualDraft(tx);
        await confirmInvoice(
          tx,
          invoiceInput.parse({
            id: d.id,
            supplierId: x.cotar,
            invoiceType: type,
            pointOfSale: "1",
            number,
            issueDate: "2026-09-01",
            items: [
              {
                description: "Leche",
                ingredientId: x.leche,
                qty: 100,
                unit: "l",
                unitPriceNet: price,
                vatRate: 21,
              },
            ],
          }),
        );
        return d.id;
      };
      const inv = await mk("A", "1", 1000);
      await mk("NC_A", "2", 100);
      expect((await getInvoice(tx, inv))!.dueDate).toBe("2026-09-16");
      const acc = await getSupplierAccount(tx, x.cotar, TODAY);
      expect(acc.balance).toBe(121000 - 12100);
      expect(acc.aging.d1_30 + acc.aging.d31_60).toBe(121000 - 12100);
      await expect(getSupplierAccount(tx, "00000000-0000-0000-0000-000000000000", TODAY)).rejects.toThrow(
        /no existe/,
      );
      await expect(
        registerSupplierPayment(
          tx,
          supplierPaymentInput.parse({
            supplierId: "00000000-0000-0000-0000-000000000000",
            date: TODAY,
            amount: 1,
            method: "cash",
          }),
        ),
      ).rejects.toThrow(/no existe/);
    });
  });
});

describe("gasto mensual (RF-12)", () => {
  it("totales neto/IVA/total por mes y por proveedor, con notas de crédito restando", async () => {
    await inRollback("nahuel", async (tx) => {
      const x = await ids(tx);
      await confirmInvoice(tx, toFormInput(await mockDraft(tx)));
      const nc = await createManualDraft(tx);
      await confirmInvoice(
        tx,
        invoiceInput.parse({
          id: nc.id,
          supplierId: x.cotar,
          invoiceType: "NC_A",
          pointOfSale: "1",
          number: "9",
          issueDate: "2026-10-03",
          items: [{ description: "Leche", qty: 10, unit: "l", unitPriceNet: 1000, vatRate: 21 }],
        }),
      );
      const m = await monthlySpend(tx, "2026-10");
      expect(m.totals).toMatchObject({
        net: 950500 - 10000,
        vat: 171412.5 - 2100,
        otherTaxes: 9505,
        invoices: 2,
      });
      expect(m.bySupplier.map((s) => [s.name, s.total])).toEqual([
        ["Leo Pelle", 1131417.5],
        ["Cotar", -12100],
      ]);
      const series = await spendByMonth(tx, "2026-10", 3);
      expect(series.map((r) => [r.month, r.invoices])).toEqual([
        ["2026-08", 0],
        ["2026-09", 0],
        ["2026-10", 2],
      ]);
      expect((await monthlySpend(tx, "2026-09")).totals.total).toBe(0);
    });
  });
});
