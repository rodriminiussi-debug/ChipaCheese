import { describe, expect, it } from "vitest";
import { and, eq, schema, type Executor } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { getSalesByChannel } from "@/features/billing/service";
import { locationByCode } from "@/features/stock/ledger";
import { getProductStockMatrix, transferProduct } from "@/features/stock/service";
import { toIsoDateAR } from "@/lib/dates";
import { cashClosingInput, storeSaleInput } from "./schemas";
import {
  closeCash,
  createStoreSale,
  getDaySummary,
  getMonthSummary,
  getStoreCatalog,
  getStoreStock,
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

const sale = (items: { productId: string; qtyUnits: number }[], method: "cash" | "transfer" = "cash") =>
  storeSaleInput.parse({ items, method });

async function localUnits(tx: Executor, productId: string) {
  const local = await locationByCode(tx, "LOCAL");
  const rows = await tx
    .select()
    .from(schema.productStock)
    .where(and(eq(schema.productStock.productId, productId), eq(schema.productStock.locationId, local.id)));
  return rows.reduce((a, r) => a + r.qty, 0);
}

describe("ventas del local (RF-33)", () => {
  it("el catálogo toma el precio de la lista del canal local y el stock de la ubicación LOCAL", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const before = await getStoreCatalog(tx, TODAY);
      const tap = before.products.find((p) => p.code === "CH-TAP-500")!;
      expect(tap).toMatchObject({ price: 4800, stock: 0 });
      expect(before.products.find((p) => p.code === "PZ-REC")!.price).toBe(1500);
      await stockLocal(tx, userId, "CH-TAP-500", 12);
      const after = await getStoreCatalog(tx, TODAY);
      expect(after.products.find((p) => p.code === "CH-TAP-500")!.stock).toBe(12);
      // Además del chipá transferido, el local tiene la reventa del stock inicial (gaseosas y aguas).
      expect((await getStoreStock(tx, TODAY)).map((s) => [s.productCode, s.qty])).toEqual(
        expect.arrayContaining([
          ["CH-TAP-500", 12],
          ["RV-GAS-500", 48],
          ["RV-AGU-500", 24],
        ]),
      );
    });
  });

  it("descuenta el stock del LOCAL por lote FEFO con movimientos store_sale negativos", async () => {
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
        with: { lot: true, product: true },
      });
      const tapItems = items.filter((i) => i.productId === tap.id).sort((a, b) => b.qtyUnits - a.qtyUnits);
      expect(tapItems.map((i) => [i.lot!.code, i.qtyUnits, i.unitPrice])).toEqual([
        ["260901-1", 60, 4800],
        ["261001-1", 5, 4800],
      ]);

      const moves = await tx.query.stockMovements.findMany({
        where: eq(schema.stockMovements.refId, res.sale.id),
      });
      expect(moves).toHaveLength(3);
      expect(moves.every((m) => m.type === "store_sale" && m.qty < 0 && m.refTable === "store_sales")).toBe(
        true,
      );
      expect(moves.every((m) => m.createdById === userId)).toBe(true);
      expect(moves.reduce((a, m) => a + m.qty, 0)).toBe(-67);

      // El LOCAL queda con 5 u. de tapitas (todas del lote nuevo) y 3 de lengüitas; el resto del stock no cambia.
      expect(await localUnits(tx, tap.id)).toBe(5);
      expect(await localUnits(tx, len.id)).toBe(3);
      const stock = await getStoreStock(tx, TODAY);
      expect(stock.find((s) => s.productCode === "CH-TAP-500")).toMatchObject({
        lotCode: "261001-1",
        qty: 5,
      });
      expect((await getProductStockMatrix(tx)).rows.find((r) => r.code === "CH-TAP-500")!.totalUnits).toBe(
        f3Before - 65,
      );
    });
  });

  it("falla con un mensaje claro si no hay stock en el local y no registra nada", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const tap = await product(tx, "CH-TAP-500");
      const len = await stockLocal(tx, userId, "CH-LEN-500", 3, "F4");
      // Sin stock de tapitas en LOCAL (aunque F3 y F4 tienen).
      await expect(
        createStoreSale(tx, userId, sale([{ productId: tap.id, qtyUnits: 1 }]), TODAY),
      ).rejects.toThrow(/No hay stock de Chipá tapitas 0,5 kg en el local/);
      // Stock parcial.
      await expect(
        createStoreSale(tx, userId, sale([{ productId: len.id, qtyUnits: 4 }]), TODAY),
      ).rejects.toThrow(/hay 3 y pediste 4/);
      // Una venta con un ítem sin stock no deja ni la venta ni los movimientos de los otros ítems.
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
      expect(storeSaleInput.safeParse({ items: [], method: "cash" }).success).toBe(false);
      expect(
        storeSaleInput.safeParse({ items: [{ productId: tap.id, qtyUnits: 0 }], method: "cash" }).success,
      ).toBe(false);
      expect(
        storeSaleInput.safeParse({ items: [{ productId: tap.id, qtyUnits: 1 }], method: "check" }).success,
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
        closedById: userId,
        notes: "Faltan $ 500",
      });
      expect(difference).toBe(-500);

      const after = await getDaySummary(tx, TODAY);
      expect(after.closing).toMatchObject({ difference: -500, stale: false });
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
      // Un día anterior sin cierre sí se puede cerrar.
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
        { date: TODAY, cash: 24000, electronic: 4800, total: 28800, count: 3, closed: true, difference: 100 },
      ]);
      expect((await getMonthSummary(tx, "2026-09")).days).toEqual([]);

      const channels = await getSalesByChannel(tx, "2026-10");
      expect(channels.byChannel.store).toMatchObject({ total: 28800, documents: 3 });
      expect(channels.byChannel.store!.net).toBeCloseTo(28800 / 1.21, 2);
    });
  });
});
