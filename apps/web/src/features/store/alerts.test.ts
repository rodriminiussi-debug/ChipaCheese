import { describe, expect, it } from "vitest";
import { eq, schema, type Executor } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { locationByCode } from "@/features/stock/ledger";
import { transferProduct } from "@/features/stock/service";
import { storeSaleInput } from "./schemas";
import { createStoreSale, voidStoreSale } from "./service";
import {
  getPreparedAvailability,
  getStoreStockAlerts,
  getStoreStockSettings,
  setStoreStockSettings,
} from "./alerts";
import { createReplenishment } from "./replenishment";

const TODAY = "2026-10-02";

const product = async (tx: Executor, code: string) =>
  (await tx.query.products.findFirst({ where: eq(schema.products.code, code) }))!;

async function stockLocal(tx: Executor, userId: string, code: string, units: number) {
  const [p, from, to] = await Promise.all([
    product(tx, code),
    locationByCode(tx, "F3"),
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

const sell = (tx: Executor, userId: string, productId: string, qtyUnits: number, day = TODAY) =>
  createStoreSale(
    tx,
    userId,
    storeSaleInput.parse({ items: [{ productId, qtyUnits }], payments: [{ method: "cash" }] }),
    day,
  );

const rowOf = async (tx: Executor, code: string, today = TODAY) =>
  (await getStoreStockAlerts(tx, today)).rows.find((r) => r.code === code)!;

describe("alertas de stock del local por demanda", () => {
  it("sin ventas: ningún producto tiene demanda que medir", async () => {
    await inRollback("local1", async (tx) => {
      const a = await getStoreStockAlerts(tx, TODAY);
      expect(a).toMatchObject({ targetDays: 3, leadDays: 1, observedDays: 0 });
      expect(a.rows.every((r) => r.status === "no_sales" && r.suggestedQty === 0)).toBe(true);
      expect(a.rows.map((r) => r.code)).toEqual(expect.arrayContaining(["CH-TAP-500", "RV-GAS-500"]));
      // Los elaborados no tienen stock propio: no aparecen como filas.
      expect(a.rows.map((r) => r.code)).not.toContain("EL-HOR-250");
      expect(a.counts).toMatchObject({ out: 0, reorder: 0, ok: 0 });
    });
  });

  it("promedia sobre los días con datos y sugiere para cubrir plazo + días objetivo", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await stockLocal(tx, userId, "CH-TAP-500", 18);
      await sell(tx, userId, tap.id, 10); // hoy: 1 día con datos → 10 por día
      const r = await rowOf(tx, "CH-TAP-500");
      expect(r).toMatchObject({
        status: "reorder",
        stock: 8,
        avgDaily: 10,
        daysLeft: 0.8,
        runsOutBeforeArrival: true,
        suggestedQty: 32, // 10 × (1 + 3) − 8
        runsOutOn: TODAY,
        fromPlant: true,
        incoming: 0,
      });
      const a = await getStoreStockAlerts(tx, TODAY);
      expect(a.observedDays).toBe(1);
      expect(a.rows[0]!.code).toBe("CH-TAP-500"); // el más urgente va primero
      expect(a.counts.reorder).toBe(1);
    });
  });

  it("agotado: sin stock y con ventas recientes", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await stockLocal(tx, userId, "CH-TAP-500", 6);
      await sell(tx, userId, tap.id, 6);
      const r = await rowOf(tx, "CH-TAP-500");
      expect(r).toMatchObject({ status: "out", stock: 0, daysLeft: 0, suggestedQty: 24 });
    });
  });

  it("ok cuando el stock cubre el plazo y los días objetivo", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await stockLocal(tx, userId, "CH-TAP-500", 50);
      await sell(tx, userId, tap.id, 10, "2026-09-22"); // 11 días con datos hasta hoy
      const r = await rowOf(tx, "CH-TAP-500");
      expect(r.avgDaily).toBe(0.909);
      expect(r).toMatchObject({ status: "ok", stock: 40, suggestedQty: 0 });
      expect(r.daysLeft).toBe(44);
    });
  });

  it("solo cuenta los últimos 30 días y promedia sobre 30 si hay historia", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await stockLocal(tx, userId, "CH-TAP-500", 100);
      await sell(tx, userId, tap.id, 50, "2026-09-02"); // fuera de la ventana (empieza el 03/09)
      await sell(tx, userId, tap.id, 30, "2026-09-10");
      const a = await getStoreStockAlerts(tx, TODAY);
      expect(a.observedDays).toBe(30);
      expect(a.rows.find((r) => r.code === "CH-TAP-500")).toMatchObject({ avgDaily: 1, stock: 20 });
    });
  });

  it("los parámetros salen de app_settings con valores por defecto si no existen", async () => {
    await inRollback("local1", async (tx, userId) => {
      expect(await getStoreStockSettings(tx)).toEqual({ targetDays: 3, leadDays: 1 });
      const tap = await stockLocal(tx, userId, "CH-TAP-500", 18);
      await sell(tx, userId, tap.id, 10);
      await setStoreStockSettings(tx, { targetDays: 5, leadDays: 2 });
      expect(await getStoreStockSettings(tx)).toEqual({ targetDays: 5, leadDays: 2 });
      expect((await rowOf(tx, "CH-TAP-500")).suggestedQty).toBe(62); // 10 × 7 − 8
      await expect(setStoreStockSettings(tx, { targetDays: 0 })).rejects.toThrow(/al menos 1/);
      await expect(setStoreStockSettings(tx, { leadDays: -1 })).rejects.toThrow(/negativo/);
      await tx.delete(schema.appSettings).where(eq(schema.appSettings.key, "store.target_days"));
      await tx.delete(schema.appSettings).where(eq(schema.appSettings.key, "store.replenish_lead_days"));
      expect(await getStoreStockSettings(tx)).toEqual({ targetDays: 3, leadDays: 1 });
      // El upsert crea los parámetros si faltaban.
      await setStoreStockSettings(tx, { targetDays: 4 });
      expect(await getStoreStockSettings(tx)).toEqual({ targetDays: 4, leadDays: 1 });
    });
  });

  it("las ventas anuladas no cuentan como demanda", async () => {
    await inRollback("local1", async (tx, userId) => {
      const gas = await product(tx, "RV-GAS-500");
      const s = await sell(tx, userId, gas.id, 20);
      expect((await rowOf(tx, "RV-GAS-500")).avgDaily).toBe(20);
      await voidStoreSale(
        tx,
        userId,
        { saleId: s.sale.id, reason: "Error" },
        { anyDay: false, today: TODAY },
      );
      const a = await getStoreStockAlerts(tx, TODAY);
      expect(a.observedDays).toBe(0);
      expect(a.rows.find((r) => r.code === "RV-GAS-500")).toMatchObject({
        status: "no_sales",
        avgDaily: 0,
        stock: 48,
      });
    });
  });

  it("la reventa también alerta, pero no se repone desde la planta", async () => {
    await inRollback("local1", async (tx, userId) => {
      const gas = await product(tx, "RV-GAS-500");
      await sell(tx, userId, gas.id, 40);
      const r = await rowOf(tx, "RV-GAS-500");
      expect(r).toMatchObject({
        status: "reorder",
        stock: 8,
        fromPlant: false,
        kind: "resale",
        suggestedQty: 152,
      });
    });
  });

  it("lo que se vende de un elaborado cuenta como demanda de su producto base", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await stockLocal(tx, userId, "CH-TAP-500", 20);
      const hor = await product(tx, "EL-HOR-250");
      await sell(tx, userId, hor.id, 8); // consume 4 bolsas
      await sell(tx, userId, tap.id, 2);
      const r = await rowOf(tx, "CH-TAP-500");
      expect(r).toMatchObject({ stock: 14, avgDaily: 6, includesPrepared: true, status: "reorder" });
      expect(r.suggestedQty).toBe(10); // 6 × 4 − 14
      const prepared = await getPreparedAvailability(tx);
      expect(prepared).toEqual([
        expect.objectContaining({
          name: expect.stringContaining("horneado"),
          available: 28,
          baseStock: 14,
          baseQty: 0.5,
        }),
      ]);
    });
  });

  it("lo ya pedido a la planta se descuenta de la sugerencia", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await stockLocal(tx, userId, "CH-TAP-500", 18);
      await sell(tx, userId, tap.id, 10);
      await createReplenishment(
        tx,
        userId,
        { items: [{ productId: tap.id, qty: 20 }], neededBy: null, notes: null },
        TODAY,
      );
      const r = await rowOf(tx, "CH-TAP-500");
      expect(r).toMatchObject({ status: "reorder", incoming: 20, suggestedQty: 12 });
    });
  });
});
