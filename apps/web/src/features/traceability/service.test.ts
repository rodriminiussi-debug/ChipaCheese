import { describe, expect, it } from "vitest";
import { eq, schema, type Tx } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { searchTrace, traceFinishedLot, traceRawLots } from "./service";
import { traceSheet } from "./export";

/** Crea un remito del lote al cliente (el demo no trae despachos). */
async function dispatchLot(tx: Tx, lotCode: string, customerLegalName: string, units: number) {
  const lot = (await tx.query.finishedLots.findFirst({ where: eq(schema.finishedLots.code, lotCode) }))!;
  const customer = (await tx.query.customers.findFirst({
    where: eq(schema.customers.legalName, customerLegalName),
  }))!;
  const order = (await tx.query.orders.findFirst())!;
  const packing = (await tx.query.packings.findFirst({ where: eq(schema.packings.finishedLotId, lot.id) }))!;
  const [d] = await tx
    .insert(schema.dispatches)
    .values({
      orderId: order.id,
      customerId: customer.id,
      dispatchedAt: new Date("2026-10-02T11:00:00-03:00"),
    })
    .returning();
  await tx
    .insert(schema.dispatchItems)
    .values({ dispatchId: d!.id, productId: packing.productId, finishedLotId: lot.id, qtyUnits: units });
  return { lot, customer, dispatch: d! };
}

describe("trazabilidad del lote terminado 260901-1 (RF-35)", () => {
  it("hacia atrás: producción, responsables, receta y consumos por insumo", async () => {
    await inRollback("rtecnico", async (tx) => {
      const t = await traceFinishedLot(tx, "260901-1");
      expect(t).not.toBeNull();
      expect(t!.lot).toMatchObject({
        code: "260901-1",
        productionDate: "2026-09-01",
        expiryDate: "2027-03-01",
        onHold: false,
      });
      expect(t!.production).toMatchObject({
        date: "2026-09-01",
        runNumber: 1,
        shift: "morning",
        starchKg: 75,
        responsible: expect.stringContaining("A.F."),
        supervisor: expect.stringContaining("N.R."),
      });
      expect(t!.production.workers).toEqual(["A.F.", "E.A.", "J.T.", "S.G.", "S.R."]);
      expect(t!.production.recipeVersion).toBeGreaterThanOrEqual(1);
      expect(t!.consumptions.map((c) => c.ingredient)).toEqual(
        expect.arrayContaining(["Fécula de mandioca", "Leche"]),
      );
      expect(t!.consumptions).toHaveLength(7);
      // La producción de septiembre es anterior a la recepción de los lotes de MP: sin lote registrado.
      expect(t!.consumptions.every((c) => c.rawLot === null)).toBe(true);
    });
  });

  it("hacia adelante: envasado por producto y ubicación, stock actual y reclamos", async () => {
    await inRollback("rtecnico", async (tx) => {
      const t = (await traceFinishedLot(tx, "260901-1"))!;
      expect(t.packings.map((p) => p.units).sort((a, b) => a - b)).toEqual([2, 12, 40, 60]);
      expect(t.totals.packedUnits).toBe(114);
      expect(t.stock.length).toBeGreaterThan(0);
      expect(t.totals.stockUnits).toBe(114);
      expect(t.dispatches).toEqual([]);
      expect(t.complaints.map((c) => c.status).sort()).toEqual(["closed", "open"]);
    });
  });

  it("incluye remitos con cliente, fecha y cantidad", async () => {
    await inRollback("rtecnico", async (tx) => {
      await dispatchLot(tx, "260901-1", "Supermercado La Reina", 30);
      const t = (await traceFinishedLot(tx, "260901-1"))!;
      expect(t.dispatches).toHaveLength(1);
      expect(t.dispatches[0]).toMatchObject({ customer: "Supermercado La Reina", units: 30 });
      expect(t.totals.dispatchedUnits).toBe(30);
    });
  });

  it("busca sin distinguir mayúsculas y devuelve null si no existe", async () => {
    await inRollback("rtecnico", async (tx) => {
      expect(await traceFinishedLot(tx, "999999-9")).toBeNull();
      const r = await searchTrace(tx, "  260901-1 ");
      expect(r.finished?.lot.code).toBe("260901-1");
      const none = await searchTrace(tx, "2609");
      expect(none.finished).toBeNull();
      expect(none.suggestions.map((s) => s.code)).toContain("260901-1");
    });
  });

  it("responde en menos de un segundo", async () => {
    await inRollback("rtecnico", async (tx) => {
      const t0 = performance.now();
      await searchTrace(tx, "260901-1");
      expect(performance.now() - t0).toBeLessThan(1000);
    });
  });
});

describe("retiro: del lote de materia prima TYBO-0925 hacia adelante (RF-35)", () => {
  it("encuentra los lotes terminados que lo usaron, con stock y despachado", async () => {
    await inRollback("rtecnico", async (tx) => {
      const [r] = await traceRawLots(tx, "TYBO-0925");
      expect(r).toBeDefined();
      expect(r!.rawLot).toMatchObject({
        ingredient: expect.stringMatching(/queso/i),
        supplierLotCode: "TYBO-0925",
        expiryDate: "2026-11-15",
        temperatureC: 4,
        supplier: expect.stringContaining("Pelle"),
      });
      expect(r!.finishedLots.map((l) => l.code)).toEqual(["261001-1"]);
      expect(r!.finishedLots[0]).toMatchObject({ qtyUsed: 22, dispatchedUnits: 0 });
      expect(r!.finishedLots[0]!.stockUnits).toBeGreaterThan(0);
      expect(r!.customers).toEqual([]);
    });
  });

  it("lista los clientes que recibieron esos lotes", async () => {
    await inRollback("rtecnico", async (tx) => {
      await dispatchLot(tx, "261001-1", "Club Náutico", 5);
      await dispatchLot(tx, "261001-1", "Supermercado La Reina", 40);
      const [r] = await traceRawLots(tx, "tybo-0925");
      expect(r!.customers.map((c) => [c.customer, c.units])).toEqual([
        ["Supermercado La Reina", 40],
        ["Club Náutico", 5],
      ]);
      expect(r!.finishedLots[0]!.dispatchedUnits).toBe(45);
    });
  });

  it("también se llega por la búsqueda general", async () => {
    await inRollback("rtecnico", async (tx) => {
      const r = await searchTrace(tx, "TYBO-0925");
      expect(r.finished).toBeNull();
      expect(r.raw).toHaveLength(1);
    });
  });
});

describe("informe PDF de trazabilidad", () => {
  it("arma la planilla con las secciones hacia atrás y hacia adelante", async () => {
    await inRollback("rtecnico", async (tx) => {
      const t = (await traceFinishedLot(tx, "260901-1"))!;
      const sheet = traceSheet({ finished: t, raw: [] }, "02/10/2026 10:00");
      expect(sheet.title).toMatch(/trazabilidad/i);
      const sections = new Set(sheet.rows.map((r) => r[0]));
      expect([...sections]).toEqual(
        expect.arrayContaining(["Producción", "Materia prima", "Envasado", "Stock", "Reclamos"]),
      );
    });
  });
});
