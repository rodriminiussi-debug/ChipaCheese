import { describe, expect, it } from "vitest";
import { and, eq, schema, type Executor } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { getSalesByChannel } from "@/features/billing/service";
import { locationByCode } from "@/features/stock/ledger";
import { getProductStockMatrix, transferProduct } from "@/features/stock/service";
import { toIsoDateAR } from "@/lib/dates";
import { cashClosingInput, resaleReceiptInput, storeSaleInput, voidSaleInput } from "./schemas";
import {
  closeCash,
  createStoreSale,
  getDaySummary,
  getMonthSummary,
  getStoreCatalog,
  getStoreCustomers,
  getStoreStock,
  receiveStoreMerchandise,
  voidStoreSale,
} from "./service";

const TODAY = "2026-10-02";

async function product(tx: Executor, code: string) {
  return (await tx.query.products.findFirst({ where: eq(schema.products.code, code) }))!;
}

/** Pasa `units` del producto de F3 (o F4) al LOCAL (FEFO) como lo haría la pantalla de stock. */
async function stockLocal(tx: Executor, userId: string, code: string, units: number, fromCode = "F3") {
  const [p, from, to] = await Promise.all([
    product(tx, code),
    locationByCode(tx, fromCode),
    locationByCode(tx, "LOCAL"),
  ]);
  await transferProduct(tx, userId, {
    productId: p.id,
    fromLocationId: from.id,
    toLocationId: to.id,
    units,
    finishedLotId: null,
    note: null,
  });
  return p;
}

type Method = "cash" | "transfer" | "card" | "qr";
const sale = (
  items: { productId: string; qtyUnits: number }[],
  method: Method = "cash",
  extra: { customerId?: string } = {},
) => storeSaleInput.parse({ items, payments: [{ method }], ...extra });

async function localUnits(tx: Executor, productId: string) {
  const local = await locationByCode(tx, "LOCAL");
  const rows = await tx
    .select()
    .from(schema.productStock)
    .where(and(eq(schema.productStock.productId, productId), eq(schema.productStock.locationId, local.id)));
  return rows.reduce((a, r) => a + r.qty, 0);
}

const movesOf = (tx: Executor, saleId: string) =>
  tx.query.stockMovements.findMany({ where: eq(schema.stockMovements.refId, saleId) });

describe("catálogo del local", () => {
  it("toma el precio de la lista local y el stock de LOCAL; incluye reventa y elaborados", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const before = await getStoreCatalog(tx, TODAY);
      const tap = before.products.find((p) => p.code === "CH-TAP-500")!;
      expect(tap).toMatchObject({ price: 4800, stock: 0, kind: "manufactured", poolId: tap.productId });
      expect(before.products.find((p) => p.code === "PZ-REC")!.price).toBe(1500);
      // Reventa con stock inicial y código de barras.
      expect(before.products.find((p) => p.code === "RV-GAS-500")).toMatchObject({
        kind: "resale",
        stock: 48,
        price: 1800,
        barcode: "7790895000997",
        consume: 1,
      });
      // El elaborado no tiene stock propio: se arma con la mitad de una bolsa de tapitas.
      expect(before.products.find((p) => p.code === "EL-HOR-250")).toMatchObject({
        kind: "prepared",
        stock: 0,
        consume: 0.5,
        poolId: tap.productId,
      });
      await stockLocal(tx, userId, "CH-TAP-500", 12);
      const after = await getStoreCatalog(tx, TODAY);
      expect(after.products.find((p) => p.code === "CH-TAP-500")!.stock).toBe(12);
      expect(after.products.find((p) => p.code === "EL-HOR-250")!.stock).toBe(24);
      expect((await getStoreStock(tx, TODAY)).map((s) => [s.productCode, s.qty])).toEqual(
        expect.arrayContaining([
          ["CH-TAP-500", 12],
          ["RV-GAS-500", 48],
          ["RV-AGU-500", 24],
        ]),
      );
    });
  });

  it("no ofrece productos desactivados ni los marcados como no disponibles en el local", async () => {
    await inRollback("nahuel", async (tx) => {
      const agua = await product(tx, "RV-AGU-500");
      await tx
        .update(schema.products)
        .set({ availableInStore: false })
        .where(eq(schema.products.id, agua.id));
      const gas = await product(tx, "RV-GAS-500");
      await tx.update(schema.products).set({ active: false }).where(eq(schema.products.id, gas.id));
      const codes = (await getStoreCatalog(tx, TODAY)).products.map((p) => p.code);
      expect(codes).not.toContain("RV-AGU-500");
      expect(codes).not.toContain("RV-GAS-500");
      await expect(
        createStoreSale(tx, null, sale([{ productId: agua.id, qtyUnits: 1 }]), TODAY),
      ).rejects.toThrow(/no está disponible para vender en el local/);
    });
  });

  it("los lotes retenidos por calidad no cuentan como stock vendible", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const tap = await stockLocal(tx, userId, "CH-TAP-500", 10);
      const moves = await tx.query.stockMovements.findMany({
        where: and(eq(schema.stockMovements.productId, tap.id), eq(schema.stockMovements.type, "transfer")),
      });
      await tx
        .update(schema.finishedLots)
        .set({ onHold: true })
        .where(eq(schema.finishedLots.id, moves[0]!.finishedLotId!));
      expect((await getStoreCatalog(tx, TODAY)).products.find((p) => p.code === "CH-TAP-500")!.stock).toBe(0);
    });
  });
});

describe("ventas del local (RF-33)", () => {
  it("fabricado: descuenta el stock del LOCAL por lote FEFO con movimientos store_sale negativos", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      // F3 tiene 60 u. del lote 260901-1 (vence antes) y 100 del 261001-1.
      const tap = await stockLocal(tx, userId, "CH-TAP-500", 70);
      const len = await stockLocal(tx, userId, "CH-LEN-500", 5, "F4");
      const f3Before = (await getProductStockMatrix(tx)).rows.find(
        (r) => r.code === "CH-TAP-500",
      )!.totalUnits;

      const res = await createStoreSale(
        tx,
        userId,
        sale([
          { productId: tap.id, qtyUnits: 65 },
          { productId: len.id, qtyUnits: 2 },
        ]),
        TODAY,
      );
      expect(res.total).toBe(65 * 4800 + 2 * 4800);
      expect(res.units).toBe(67);

      // Ítems por lote: primero se agota el lote que vence antes.
      const items = await tx.query.storeSaleItems.findMany({
        where: eq(schema.storeSaleItems.saleId, res.sale.id),
        with: { lot: true },
      });
      const tapItems = items.filter((i) => i.productId === tap.id).sort((a, b) => b.qtyUnits - a.qtyUnits);
      expect(tapItems.map((i) => [i.lot!.code, i.qtyUnits, i.unitPrice])).toEqual([
        ["260901-1", 60, 4800],
        ["261001-1", 5, 4800],
      ]);

      const moves = await movesOf(tx, res.sale.id);
      expect(moves).toHaveLength(3);
      expect(moves.every((m) => m.type === "store_sale" && m.qty < 0 && m.refTable === "store_sales")).toBe(
        true,
      );
      expect(moves.every((m) => m.createdById === userId)).toBe(true);
      expect(moves.reduce((a, m) => a + m.qty, 0)).toBe(-67);

      expect(await localUnits(tx, tap.id)).toBe(5);
      expect(await localUnits(tx, len.id)).toBe(3);
      expect((await getStoreStock(tx, TODAY)).find((s) => s.productCode === "CH-TAP-500")).toMatchObject({
        lotCode: "261001-1",
        qty: 5,
      });
      expect((await getProductStockMatrix(tx)).rows.find((r) => r.code === "CH-TAP-500")!.totalUnits).toBe(
        f3Before - 65,
      );
    });
  });

  it("reventa: descuenta su stock en LOCAL, sin lote", async () => {
    await inRollback("local1", async (tx, userId) => {
      const gas = await product(tx, "RV-GAS-500");
      const res = await createStoreSale(
        tx,
        userId,
        sale([{ productId: gas.id, qtyUnits: 6 }], "card"),
        TODAY,
      );
      expect(res.total).toBe(6 * 1800);
      const items = await tx.query.storeSaleItems.findMany({
        where: eq(schema.storeSaleItems.saleId, res.sale.id),
      });
      expect(items).toMatchObject([{ productId: gas.id, finishedLotId: null, qtyUnits: 6, unitPrice: 1800 }]);
      const moves = await movesOf(tx, res.sale.id);
      expect(moves).toMatchObject([
        { type: "store_sale", productId: gas.id, finishedLotId: null, qty: -6, refTable: "store_sales" },
      ]);
      expect(await localUnits(tx, gas.id)).toBe(42);
    });
  });

  it("reventa sin stock suficiente: error claro y no escribe nada", async () => {
    await inRollback("local1", async (tx, userId) => {
      const gas = await product(tx, "RV-GAS-500");
      await expect(
        createStoreSale(tx, userId, sale([{ productId: gas.id, qtyUnits: 49 }]), TODAY),
      ).rejects.toThrow(/No hay stock suficiente de Gaseosa 500 ml en el local: hay 48 y pediste 49/);
      expect(await tx.select().from(schema.storeSales)).toHaveLength(0);
      expect(await localUnits(tx, gas.id)).toBe(48);
    });
  });

  it("elaborado: la línea queda con el elaborado y el movimiento descuenta baseQty × cantidad del base por FEFO", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await stockLocal(tx, userId, "CH-TAP-500", 3);
      const hor = await product(tx, "EL-HOR-250");
      const res = await createStoreSale(tx, userId, sale([{ productId: hor.id, qtyUnits: 5 }], "qr"), TODAY);
      expect(res.total).toBe(5 * 3200);
      const items = await tx.query.storeSaleItems.findMany({
        where: eq(schema.storeSaleItems.saleId, res.sale.id),
        with: { lot: true },
      });
      expect(items.map((i) => [i.productId, i.qtyUnits, i.unitPrice, i.lot!.code])).toEqual([
        [hor.id, 5, 3200, "260901-1"],
      ]);
      const moves = await movesOf(tx, res.sale.id);
      expect(moves).toMatchObject([
        { type: "store_sale", productId: tap.id, qty: -2.5, refTable: "store_sales" },
      ]);
      expect(moves[0]!.finishedLotId).toBe(items[0]!.finishedLotId);
      // Quedan 0,5 bolsas → alcanza para 1 elaborado más.
      expect(await localUnits(tx, tap.id)).toBe(0.5);
      expect((await getStoreCatalog(tx, TODAY)).products.find((p) => p.code === "EL-HOR-250")!.stock).toBe(1);
    });
  });

  it("elaborado sin stock del base: error claro y no escribe nada", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await stockLocal(tx, userId, "CH-TAP-500", 1);
      const hor = await product(tx, "EL-HOR-250");
      await expect(
        createStoreSale(tx, userId, sale([{ productId: hor.id, qtyUnits: 3 }]), TODAY),
      ).rejects.toThrow(
        /No hay stock suficiente para Chipá horneado 250 g.*Chipá tapitas 0,5 kg.*alcanza para 2/,
      );
      expect(await tx.select().from(schema.storeSales)).toHaveLength(0);
      expect(await localUnits(tx, tap.id)).toBe(1);
    });
  });

  it("un elaborado y su base en la misma venta comparten el stock del base", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await stockLocal(tx, userId, "CH-TAP-500", 4);
      const hor = await product(tx, "EL-HOR-250");
      // 2 bolsas + 4 elaborados (2 bolsas) = 4: alcanza justo.
      const res = await createStoreSale(
        tx,
        userId,
        sale([
          { productId: tap.id, qtyUnits: 2 },
          { productId: hor.id, qtyUnits: 4 },
        ]),
        TODAY,
      );
      expect(res.total).toBe(2 * 4800 + 4 * 3200);
      expect(await localUnits(tx, tap.id)).toBe(0);
      // Un elaborado más ya no alcanza.
      await expect(
        createStoreSale(tx, userId, sale([{ productId: hor.id, qtyUnits: 1 }]), TODAY),
      ).rejects.toThrow(/No hay stock suficiente/);
    });
  });

  it("falla con un mensaje claro si no hay stock en el local y no registra nada", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const tap = await product(tx, "CH-TAP-500");
      const len = await stockLocal(tx, userId, "CH-LEN-500", 3, "F4");
      await expect(
        createStoreSale(tx, userId, sale([{ productId: tap.id, qtyUnits: 1 }]), TODAY),
      ).rejects.toThrow(/No hay stock de Chipá tapitas 0,5 kg en el local/);
      await expect(
        createStoreSale(tx, userId, sale([{ productId: len.id, qtyUnits: 4 }]), TODAY),
      ).rejects.toThrow(/hay 3 y pediste 4/);
      await expect(
        createStoreSale(
          tx,
          userId,
          sale([
            { productId: len.id, qtyUnits: 1 },
            { productId: tap.id, qtyUnits: 1 },
          ]),
          TODAY,
        ),
      ).rejects.toThrow(/No hay stock/);
      expect(await tx.select().from(schema.storeSales)).toHaveLength(0);
      expect(await tx.select().from(schema.storeSalePayments)).toHaveLength(0);
      expect(await localUnits(tx, len.id)).toBe(3);
    });
  });

  it("suma las líneas repetidas del mismo producto y valida el esquema", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const tap = await stockLocal(tx, userId, "CH-TAP-500", 10);
      const res = await createStoreSale(
        tx,
        userId,
        sale([
          { productId: tap.id, qtyUnits: 2 },
          { productId: tap.id, qtyUnits: 3 },
        ]),
        TODAY,
      );
      expect(res.units).toBe(5);
      expect(res.total).toBe(24000);
      const pay = [{ method: "cash" }];
      expect(storeSaleInput.safeParse({ items: [], payments: pay }).success).toBe(false);
      expect(
        storeSaleInput.safeParse({ items: [{ productId: tap.id, qtyUnits: 0 }], payments: pay }).success,
      ).toBe(false);
      expect(
        storeSaleInput.safeParse({
          items: [{ productId: tap.id, qtyUnits: 1 }],
          payments: [{ method: "check" }],
        }).success,
      ).toBe(false);
      expect(
        storeSaleInput.safeParse({ items: [{ productId: tap.id, qtyUnits: 1 }], payments: [] }).success,
      ).toBe(false);
    });
  });

  it("registra la venta en el día de negocio (aunque el reloj esté congelado) y con vendedor", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await stockLocal(tx, userId, "CH-TAP-500", 2);
      const { sale: s } = await createStoreSale(
        tx,
        userId,
        sale([{ productId: tap.id, qtyUnits: 1 }], "transfer"),
        TODAY,
      );
      expect(toIsoDateAR(s.soldAt)).toBe(TODAY);
      expect(s).toMatchObject({ sellerId: userId, method: "transfer", total: 4800 });
      const day = await getDaySummary(tx, TODAY);
      expect(day.sales.map((x) => x.id)).toEqual([s.id]);
    });
  });

  it("venta mayorista: con cliente usa los precios de su lista y queda registrado", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await stockLocal(tx, userId, "CH-TAP-500", 10);
      const customers = await getStoreCustomers(tx, TODAY);
      const esperanza = customers.find((c) => c.name.includes("La Esperanza"))!;
      expect(esperanza.prices[tap.id]).toBe(4200);
      expect(customers.some((c) => c.name.includes("mostrador"))).toBe(false);
      const res = await createStoreSale(
        tx,
        userId,
        sale([{ productId: tap.id, qtyUnits: 10 }], "transfer", { customerId: esperanza.id }),
        TODAY,
      );
      expect(res.total).toBe(42_000);
      expect(res.sale.customerId).toBe(esperanza.id);
      await expect(
        createStoreSale(
          tx,
          userId,
          sale([{ productId: tap.id, qtyUnits: 1 }], "cash", { customerId: crypto.randomUUID() }),
          TODAY,
        ),
      ).rejects.toThrow(/cliente no existe/);
    });
  });
});

describe("medios de pago", () => {
  it("tarjeta y QR se registran como pago de la venta", async () => {
    await inRollback("local1", async (tx, userId) => {
      const gas = await product(tx, "RV-GAS-500");
      const a = await createStoreSale(tx, userId, sale([{ productId: gas.id, qtyUnits: 1 }], "card"), TODAY);
      const b = await createStoreSale(tx, userId, sale([{ productId: gas.id, qtyUnits: 2 }], "qr"), TODAY);
      expect(a.sale.method).toBe("card");
      expect(b.sale.method).toBe("qr");
      const pays = await tx.query.storeSalePayments.findMany({
        where: eq(schema.storeSalePayments.saleId, b.sale.id),
      });
      expect(pays).toMatchObject([{ method: "qr", amount: 3600 }]);
    });
  });

  it("pago dividido: dos medios que suman el total; el medio principal es el de mayor monto", async () => {
    await inRollback("local1", async (tx, userId) => {
      const gas = await product(tx, "RV-GAS-500");
      const items = [{ productId: gas.id, qtyUnits: 5 }]; // 9.000
      const res = await createStoreSale(
        tx,
        userId,
        storeSaleInput.parse({
          items,
          payments: [
            { method: "cash", amount: "2.000" },
            { method: "card", amount: 7000 },
          ],
        }),
        TODAY,
      );
      expect(res.sale.method).toBe("card");
      const pays = await tx.query.storeSalePayments.findMany({
        where: eq(schema.storeSalePayments.saleId, res.sale.id),
      });
      expect(pays.map((p) => [p.method, p.amount]).sort()).toEqual([
        ["card", 7000],
        ["cash", 2000],
      ]);
      const day = await getDaySummary(tx, TODAY);
      expect(day.totals.byMethod).toEqual({ cash: 2000, transfer: 0, card: 7000, qr: 0 });
      expect(day.totals.total).toBe(9000);
    });
  });

  it("los pagos tienen que sumar el total y no repetir medio", async () => {
    await inRollback("local1", async (tx, userId) => {
      const gas = await product(tx, "RV-GAS-500");
      const items = [{ productId: gas.id, qtyUnits: 5 }];
      await expect(
        createStoreSale(
          tx,
          userId,
          storeSaleInput.parse({
            items,
            payments: [
              { method: "cash", amount: 2000 },
              { method: "card", amount: 6000 },
            ],
          }),
          TODAY,
        ),
      ).rejects.toThrow(/Los pagos suman/);
      await expect(
        createStoreSale(
          tx,
          userId,
          storeSaleInput.parse({ items, payments: [{ method: "cash", amount: 100 }] }),
          TODAY,
        ),
      ).rejects.toThrow(/no coincide con el total/);
      expect(await tx.select().from(schema.storeSales)).toHaveLength(0);
      const dup = storeSaleInput.safeParse({
        items,
        payments: [
          { method: "cash", amount: 1 },
          { method: "cash", amount: 2 },
        ],
      });
      expect(dup.success).toBe(false);
      expect(
        storeSaleInput.safeParse({ items, payments: [{ method: "cash" }, { method: "card", amount: 5 }] })
          .success,
      ).toBe(false);
    });
  });
});

describe("cierre de caja (RF-33)", () => {
  async function sellSomething(tx: Executor, userId: string) {
    const tap = await stockLocal(tx, userId, "CH-TAP-500", 20);
    await createStoreSale(tx, userId, sale([{ productId: tap.id, qtyUnits: 3 }], "cash"), TODAY); // 14.400
    await createStoreSale(tx, userId, sale([{ productId: tap.id, qtyUnits: 2 }], "cash"), TODAY); // 9.600
    await createStoreSale(tx, userId, sale([{ productId: tap.id, qtyUnits: 1 }], "transfer"), TODAY); // 4.800
    return tap;
  }

  it("el efectivo esperado es el de las ventas en efectivo del día; la diferencia es contado − esperado", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      await sellSomething(tx, userId);
      const day = await getDaySummary(tx, TODAY);
      expect(day.totals).toMatchObject({ cash: 24000, electronic: 4800, total: 28800, count: 3, units: 6 });
      expect(day.closing).toBeNull();

      const { closing, difference } = await closeCash(
        tx,
        userId,
        cashClosingInput.parse({ countedCash: "23.500", notes: "Faltan $ 500" }),
        TODAY,
      );
      expect(closing).toMatchObject({
        date: TODAY,
        expectedCash: 24000,
        countedCash: 23500,
        expectedTransfer: 4800,
        expectedCard: 0,
        expectedQr: 0,
        closedById: userId,
        notes: "Faltan $ 500",
      });
      expect(difference).toBe(-500);
      expect((await getDaySummary(tx, TODAY)).closing).toMatchObject({ difference: -500, stale: false });
    });
  });

  it("el cierre separa efectivo, transferencia, tarjeta y QR (incluye pagos divididos)", async () => {
    await inRollback("local1", async (tx, userId) => {
      const gas = await product(tx, "RV-GAS-500");
      const one = (n: number, method: Method) =>
        createStoreSale(tx, userId, sale([{ productId: gas.id, qtyUnits: n }], method), TODAY);
      await one(2, "cash"); // 3.600
      await one(1, "transfer"); // 1.800
      await one(3, "card"); // 5.400
      await one(4, "qr"); // 7.200
      await createStoreSale(
        tx,
        userId,
        storeSaleInput.parse({
          items: [{ productId: gas.id, qtyUnits: 2 }],
          payments: [
            { method: "cash", amount: 1000 },
            { method: "qr", amount: 2600 },
          ],
        }),
        TODAY,
      );
      const day = await getDaySummary(tx, TODAY);
      expect(day.totals.byMethod).toEqual({ cash: 4600, transfer: 1800, card: 5400, qr: 9800 });
      expect(day.totals.electronic).toBe(17000);
      expect(day.totals.count).toBe(5);

      const { closing } = await closeCash(tx, userId, cashClosingInput.parse({ countedCash: 4600 }), TODAY);
      expect(closing).toMatchObject({
        expectedCash: 4600,
        expectedTransfer: 1800,
        expectedCard: 5400,
        expectedQr: 9800,
      });
      const month = await getMonthSummary(tx, "2026-10");
      expect(month.totals.byMethod).toEqual({ cash: 4600, transfer: 1800, card: 5400, qr: 9800 });
      expect(month.days).toEqual([
        expect.objectContaining({
          date: TODAY,
          cash: 4600,
          electronic: 17000,
          total: 21600,
          count: 5,
          closed: true,
        }),
      ]);
    });
  });

  it("hay un solo cierre por día y no se puede cerrar un día futuro", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      await closeCash(tx, userId, cashClosingInput.parse({ countedCash: 0 }), TODAY);
      await expect(closeCash(tx, userId, cashClosingInput.parse({ countedCash: 0 }), TODAY)).rejects.toThrow(
        /ya está cerrada/,
      );
      await expect(
        closeCash(tx, userId, cashClosingInput.parse({ countedCash: 0, date: "2026-10-05" }), TODAY),
      ).rejects.toThrow(/futuro/);
      const past = await closeCash(
        tx,
        userId,
        cashClosingInput.parse({ countedCash: 0, date: "2026-10-01" }),
        TODAY,
      );
      expect(past.closing.date).toBe("2026-10-01");
    });
  });

  it("avisa si hubo ventas después de cerrar la caja", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const tap = await sellSomething(tx, userId);
      await closeCash(tx, userId, cashClosingInput.parse({ countedCash: 24000 }), TODAY);
      await createStoreSale(tx, userId, sale([{ productId: tap.id, qtyUnits: 1 }]), TODAY);
      const day = await getDaySummary(tx, TODAY);
      expect(day.closing).toMatchObject({ stale: true, expectedCash: 24000 });
      expect(day.totals.cash).toBe(28800);
    });
  });

  it("resume el mes día por día y las ventas del local cuentan como canal local para el tablero", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      await sellSomething(tx, userId);
      await closeCash(tx, userId, cashClosingInput.parse({ countedCash: 24100 }), TODAY);
      const month = await getMonthSummary(tx, "2026-10");
      expect(month.totals).toMatchObject({ total: 28800, cash: 24000, electronic: 4800, count: 3 });
      expect(month.days).toEqual([
        {
          date: TODAY,
          byMethod: { cash: 24000, transfer: 4800, card: 0, qr: 0 },
          cash: 24000,
          electronic: 4800,
          total: 28800,
          count: 3,
          closed: true,
          difference: 100,
        },
      ]);
      expect((await getMonthSummary(tx, "2026-09")).days).toEqual([]);

      const channels = await getSalesByChannel(tx, "2026-10");
      expect(channels.byChannel.store).toMatchObject({ total: 28800, documents: 3 });
      expect(channels.byChannel.store!.net).toBeCloseTo(28800 / 1.21, 2);
    });
  });
});

describe("anular venta", () => {
  it("devuelve el stock al mismo lote, marca la venta y deja de contar en todos los totales", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await stockLocal(tx, userId, "CH-TAP-500", 70);
      const keep = await createStoreSale(
        tx,
        userId,
        sale([{ productId: tap.id, qtyUnits: 1 }], "cash"),
        TODAY,
      );
      const bad = await createStoreSale(
        tx,
        userId,
        sale([{ productId: tap.id, qtyUnits: 65 }], "card"),
        TODAY,
      );
      expect(await localUnits(tx, tap.id)).toBe(4);
      const soldMoves = await movesOf(tx, bad.sale.id);

      const res = await voidStoreSale(
        tx,
        userId,
        voidSaleInput.parse({ saleId: bad.sale.id, reason: "Cargué mal la cantidad" }),
        {
          anyDay: false,
          today: TODAY,
        },
      );
      expect(res.returnedUnits).toBe(65);
      expect(res.sale).toMatchObject({ voidedById: userId, voidReason: "Cargué mal la cantidad" });
      expect(res.sale.voidedAt).toBeInstanceOf(Date);
      expect(await localUnits(tx, tap.id)).toBe(69);

      // Un `return` por cada movimiento de la venta, mismo lote y ubicación, con signo contrario.
      const all = await movesOf(tx, bad.sale.id);
      const returns = all.filter((m) => m.type === "return");
      expect(returns.map((m) => [m.finishedLotId, m.locationId, m.qty]).sort()).toEqual(
        soldMoves.map((m) => [m.finishedLotId, m.locationId, -m.qty]).sort(),
      );

      // La venta no se borra, pero no cuenta.
      const day = await getDaySummary(tx, TODAY);
      expect(day.sales).toHaveLength(2);
      expect(day.voidedCount).toBe(1);
      expect(day.totals).toMatchObject({ count: 1, total: 4800, cash: 4800, units: 1 });
      expect(day.totals.byMethod.card).toBe(0);
      expect((await getMonthSummary(tx, "2026-10")).totals).toMatchObject({ total: 4800, count: 1 });
      expect((await getSalesByChannel(tx, "2026-10")).byChannel.store).toMatchObject({
        total: 4800,
        documents: 1,
      });
      const { closing } = await closeCash(tx, userId, cashClosingInput.parse({ countedCash: 4800 }), TODAY);
      expect(closing).toMatchObject({ expectedCash: 4800, expectedCard: 0 });
      expect(keep.sale.voidedAt).toBeNull();
    });
  });

  it("anular un elaborado devuelve el stock del producto base", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await stockLocal(tx, userId, "CH-TAP-500", 4);
      const hor = await product(tx, "EL-HOR-250");
      const s = await createStoreSale(tx, userId, sale([{ productId: hor.id, qtyUnits: 3 }]), TODAY);
      expect(await localUnits(tx, tap.id)).toBe(2.5);
      await voidStoreSale(
        tx,
        userId,
        { saleId: s.sale.id, reason: "Error de carga" },
        { anyDay: false, today: TODAY },
      );
      expect(await localUnits(tx, tap.id)).toBe(4);
    });
  });

  it("anular una venta de reventa devuelve las botellas sin lote", async () => {
    await inRollback("local1", async (tx, userId) => {
      const gas = await product(tx, "RV-GAS-500");
      const s = await createStoreSale(tx, userId, sale([{ productId: gas.id, qtyUnits: 6 }]), TODAY);
      await voidStoreSale(
        tx,
        userId,
        { saleId: s.sale.id, reason: "Se arrepintió" },
        { anyDay: false, today: TODAY },
      );
      expect(await localUnits(tx, gas.id)).toBe(48);
    });
  });

  it("el motivo es obligatorio y una venta no se anula dos veces", async () => {
    await inRollback("local1", async (tx, userId) => {
      const gas = await product(tx, "RV-GAS-500");
      const s = await createStoreSale(tx, userId, sale([{ productId: gas.id, qtyUnits: 1 }]), TODAY);
      expect(voidSaleInput.safeParse({ saleId: s.sale.id, reason: "  " }).success).toBe(false);
      expect(voidSaleInput.safeParse({ saleId: s.sale.id }).success).toBe(false);
      await voidStoreSale(
        tx,
        userId,
        { saleId: s.sale.id, reason: "Error" },
        { anyDay: false, today: TODAY },
      );
      await expect(
        voidStoreSale(tx, userId, { saleId: s.sale.id, reason: "Otra vez" }, { anyDay: true, today: TODAY }),
      ).rejects.toThrow(/ya está anulada/);
      await expect(
        voidStoreSale(
          tx,
          userId,
          { saleId: crypto.randomUUID(), reason: "No existe" },
          { anyDay: true, today: TODAY },
        ),
      ).rejects.toThrow(/no existe/);
      expect(await localUnits(tx, gas.id)).toBe(48);
    });
  });

  it("la empleada no anula con la caja cerrada ni ventas de otro día; Dirección sí", async () => {
    await inRollback("local1", async (tx, userId) => {
      const gas = await product(tx, "RV-GAS-500");
      const s = await createStoreSale(tx, userId, sale([{ productId: gas.id, qtyUnits: 2 }], "cash"), TODAY);
      await closeCash(tx, userId, cashClosingInput.parse({ countedCash: 3600 }), TODAY);
      await expect(
        voidStoreSale(tx, userId, { saleId: s.sale.id, reason: "Error" }, { anyDay: false, today: TODAY }),
      ).rejects.toThrow(/caja de hoy ya está cerrada/);
      expect(await localUnits(tx, gas.id)).toBe(46);

      // Dirección la anula igual: el cierre queda marcado como desactualizado.
      await voidStoreSale(
        tx,
        userId,
        { saleId: s.sale.id, reason: "Error de carga" },
        { anyDay: true, today: TODAY },
      );
      expect(await localUnits(tx, gas.id)).toBe(48);
      expect((await getDaySummary(tx, TODAY)).closing).toMatchObject({ stale: true, expectedCash: 3600 });
    });

    await inRollback("local1", async (tx, userId) => {
      const gas = await product(tx, "RV-GAS-500");
      const s = await createStoreSale(tx, userId, sale([{ productId: gas.id, qtyUnits: 1 }]), TODAY);
      // Mañana, la venta de ayer ya no la puede anular la empleada.
      await expect(
        voidStoreSale(
          tx,
          userId,
          { saleId: s.sale.id, reason: "Error" },
          { anyDay: false, today: "2026-10-03" },
        ),
      ).rejects.toThrow(/Solo se pueden anular ventas de hoy/);
      await voidStoreSale(
        tx,
        userId,
        { saleId: s.sale.id, reason: "Error" },
        { anyDay: true, today: "2026-10-03" },
      );
    });
  });
});

describe("ingreso de mercadería de reventa en el local", () => {
  it("suma stock en LOCAL, registra costo y proveedor", async () => {
    await inRollback("local1", async (tx, userId) => {
      const gas = await product(tx, "RV-GAS-500");
      const supplier = (await tx.query.suppliers.findFirst())!;
      const res = await receiveStoreMerchandise(
        tx,
        userId,
        resaleReceiptInput.parse({
          items: [{ productId: gas.id, qty: 24, unitCostNet: "1.150" }],
          supplierId: supplier.id,
        }),
        TODAY,
      );
      expect(res).toMatchObject({ location: "LOCAL", items: 1 });
      expect(await localUnits(tx, gas.id)).toBe(72);
      const cost = await tx.query.productCosts.findMany({ where: eq(schema.productCosts.productId, gas.id) });
      expect(cost.find((c) => c.date === TODAY)).toMatchObject({
        unitCostNet: 1150,
        supplierId: supplier.id,
      });
      const mv = await tx.query.stockMovements.findMany({
        where: and(eq(schema.stockMovements.productId, gas.id), eq(schema.stockMovements.type, "receipt")),
      });
      expect(
        mv.some((m) => m.qty === 24 && m.createdById === userId && m.refTable === "resale_receipt"),
      ).toBe(true);
    });
  });

  it("solo acepta productos de reventa y cantidades válidas", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await product(tx, "CH-TAP-500");
      await expect(
        receiveStoreMerchandise(
          tx,
          userId,
          resaleReceiptInput.parse({ items: [{ productId: tap.id, qty: 5 }] }),
          TODAY,
        ),
      ).rejects.toThrow(/no es un producto de reventa/);
      expect(resaleReceiptInput.safeParse({ items: [] }).success).toBe(false);
      expect(resaleReceiptInput.safeParse({ items: [{ productId: tap.id, qty: 0 }] }).success).toBe(false);
    });
  });
});
