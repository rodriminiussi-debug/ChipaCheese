import { describe, expect, it } from "vitest";
import { eq, schema, type Executor } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { ingredientTotals } from "../stock/ledger";
import {
  createRunInput,
  recordConsumptionsPayload,
  recordPackingInput,
  recordWeighingsInput,
  setRunStatusInput,
  setRunStatusPayload,
} from "./schemas";
import {
  consumptionSuggestions,
  createRun,
  getRun,
  recordConsumptions,
  recordPacking,
  recordWeighings,
  runSummary,
  setRunStatus,
} from "./service";

/**
 * Carga sin señal (RF-20, RF-21, RF-22): reenviar el mismo `clientId` desde la cola offline no debe
 * repetir el efecto (ni consumos, ni pesadas, ni envasados, ni movimientos de stock).
 */
const TODAY = "2026-10-02";

async function ids(db: Executor) {
  const users = await db.query.users.findMany();
  const ingredients = await db.query.ingredients.findMany();
  const products = await db.query.products.findMany();
  const locations = await db.query.locations.findMany();
  return {
    u: (n: string) => users.find((x) => x.username === n)!.id,
    i: (n: string) => ingredients.find((x) => x.name.startsWith(n))!.id,
    p: (c: string) => products.find((x) => x.code === c)!.id,
    l: (c: string) => locations.find((x) => x.code === c)!.id,
  };
}

async function newRun(db: Executor) {
  const { u } = await ids(db);
  return createRun(
    db,
    createRunInput.parse({ date: TODAY, responsibleId: u("af"), workerIds: [u("jt")] }),
    TODAY,
  );
}

const stockOf = async (db: Executor, ingredientId: string) => (await ingredientTotals(db))[ingredientId] ?? 0;

/** Movimientos de stock que cuelgan de un documento (producción o envasado). */
async function movesOf(db: Executor, refTable: string, refIds: string[]) {
  const rows = await db.select().from(schema.stockMovements);
  return rows.filter((m) => m.refTable === refTable && m.refId && refIds.includes(m.refId));
}

describe("consumos sin señal (RF-20)", () => {
  async function setup(tx: Executor) {
    const run = await newRun(tx);
    const sug = await consumptionSuggestions(tx, (await getRun(tx, run.id))!);
    const lines = sug.flatMap((s) =>
      s.lines.map((ln) => ({ ingredientId: s.ingredientId, rawLotId: ln.rawLotId, qty: ln.qty })),
    );
    return { run, lines };
  }

  it("confirmar dos veces con el mismo clientId no revierte ni duplica movimientos", async () => {
    await inRollback("af", async (tx, userId) => {
      const { i } = await ids(tx);
      const { run, lines } = await setup(tx);
      const recordedAt = new Date("2026-10-02T09:00:00-03:00");
      const payload = (clientId: string) =>
        recordConsumptionsPayload.parse({
          runId: run.id,
          lines,
          clientId,
          recordedAt: recordedAt.toISOString(),
        });
      const A = crypto.randomUUID();
      const before = await stockOf(tx, i("Leche"));

      const first = await recordConsumptions(tx, userId, payload(A), { clientId: A, recordedAt });
      expect(first.duplicate).toBe(false);
      const afterFirst = await stockOf(tx, i("Leche"));
      const moves = await movesOf(tx, "production_runs", [run.id]);
      expect(afterFirst).toBeLessThan(before);
      expect(moves.every((m) => m.occurredAt.getTime() === recordedAt.getTime())).toBe(true);

      // Reenvío del mismo registro (se perdió la respuesta): un solo efecto.
      const again = await recordConsumptions(tx, userId, payload(A), { clientId: A, recordedAt });
      expect(again.duplicate).toBe(true);
      expect(again.rows).toHaveLength(first.rows.length);
      expect(await stockOf(tx, i("Leche"))).toBe(afterFirst);
      expect(await movesOf(tx, "production_runs", [run.id])).toHaveLength(moves.length);
      expect((await getRun(tx, run.id))!.consumptions).toHaveLength(first.rows.length);
      const confirmations = await tx.query.productionConsumptionConfirmations.findMany();
      expect(confirmations.filter((c) => c.runId === run.id)).toHaveLength(1);

      // Una corrección real (otro clientId) sí reemplaza: revierte y vuelve a cargar...
      const B = crypto.randomUUID();
      const corrected = await recordConsumptions(tx, userId, payload(B), { clientId: B, recordedAt });
      expect(corrected.duplicate).toBe(false);
      expect(await stockOf(tx, i("Leche"))).toBe(afterFirst);
      const movesAfterB = (await movesOf(tx, "production_runs", [run.id])).length;
      expect(movesAfterB).toBeGreaterThan(moves.length);

      // ...y el reenvío tardío del primero ya no puede pisar la corrección.
      const late = await recordConsumptions(tx, userId, payload(A), { clientId: A, recordedAt });
      expect(late.duplicate).toBe(true);
      expect(await movesOf(tx, "production_runs", [run.id])).toHaveLength(movesAfterB);
    });
  });

  it("el reenvío sigue siendo duplicado aunque la producción ya avanzó de estado", async () => {
    await inRollback("af", async (tx, userId) => {
      const { run, lines } = await setup(tx);
      const A = crypto.randomUUID();
      await recordConsumptions(tx, userId, { runId: run.id, lines }, { clientId: A });
      await setRunStatus(
        tx,
        setRunStatusInput.parse({ runId: run.id, status: "freezing", freezerCodes: ["F1"] }),
      );
      const again = await recordConsumptions(tx, userId, { runId: run.id, lines }, { clientId: A });
      expect(again.duplicate).toBe(true);
    });
  });

  it("sin clientId se comporta como antes (reemplaza en cada confirmación)", async () => {
    await inRollback("af", async (tx, userId) => {
      const { i } = await ids(tx);
      const { run, lines } = await setup(tx);
      await recordConsumptions(tx, userId, { runId: run.id, lines });
      const once = await stockOf(tx, i("Leche"));
      await recordConsumptions(tx, userId, { runId: run.id, lines });
      expect(await stockOf(tx, i("Leche"))).toBe(once);
      expect(await tx.query.productionConsumptionConfirmations.findMany()).toHaveLength(0);
    });
  });
});

describe("pesadas sin señal (RF-21)", () => {
  it("el mismo clientId se carga una sola vez y toma la hora real", async () => {
    await inRollback("af", async (tx, userId) => {
      const run = await newRun(tx);
      await setRunStatus(tx, setRunStatusInput.parse({ runId: run.id, status: "in_progress" }));
      const clientId = crypto.randomUUID();
      const recordedAt = new Date("2026-10-02T11:15:00-03:00");
      const input = recordWeighingsInput.parse({
        runId: run.id,
        items: [
          { shape: "tapita", kg: 40 },
          { shape: "arito", kg: 0 }, // se descarta, no desfasa los ids derivados
          { shape: "lenguita", kg: 30 },
        ],
      });
      const first = await recordWeighings(tx, userId, input, { clientId, recordedAt });
      const again = await recordWeighings(tx, userId, input, { clientId, recordedAt });
      expect(first).toHaveLength(2);
      expect(again.map((r) => r.id).sort()).toEqual(first.map((r) => r.id).sort());
      const stored = (await getRun(tx, run.id))!.weighings;
      expect(stored).toHaveLength(2);
      expect(stored.every((w) => w.weighedAt.getTime() === recordedAt.getTime())).toBe(true);
      expect(runSummary((await getRun(tx, run.id))!).weighedKg).toBe(70);

      // Otro envío (otro clientId) con las mismas cantidades es otra pesada: se suma.
      await recordWeighings(tx, userId, input, { clientId: crypto.randomUUID(), recordedAt });
      expect((await getRun(tx, run.id))!.weighings).toHaveLength(4);
    });
  });
});

describe("envasado sin señal (RF-22)", () => {
  it("el mismo clientId no duplica el packing ni el stock de producto ni de envases", async () => {
    await inRollback("af", async (tx, userId) => {
      const { p, l, i } = await ids(tx);
      const run = await newRun(tx);
      await setRunStatus(tx, setRunStatusInput.parse({ runId: run.id, status: "in_progress" }));
      const bags = await stockOf(tx, i("Bolsa 0,5"));
      const clientId = crypto.randomUUID();
      const recordedAt = new Date("2026-10-02T16:40:00-03:00");
      const input = recordPackingInput.parse({
        runId: run.id,
        items: [
          { productId: p("CH-TAP-500"), units: 30, locationId: l("F3") },
          { productId: p("CH-LEN-5K"), units: 2, locationId: l("F4") },
        ],
      });
      const first = await recordPacking(tx, userId, input, { clientId, recordedAt });
      const again = await recordPacking(tx, userId, input, { clientId, recordedAt });
      expect(first.duplicate).toBe(false);
      expect(again.duplicate).toBe(true);
      expect(again.lot.id).toBe(first.lot.id);
      expect(again.packings.map((x) => x.id).sort()).toEqual(first.packings.map((x) => x.id).sort());

      const packings = (await getRun(tx, run.id))!.lots.flatMap((x) => x.packings);
      expect(packings).toHaveLength(2);
      expect(packings.every((x) => x.packedAt.getTime() === recordedAt.getTime())).toBe(true);
      const moves = await movesOf(
        tx,
        "packings",
        packings.map((x) => x.id),
      );
      // Entradas de producto terminado una sola vez, y los envases descontados una sola vez.
      const product = moves.filter((m) => m.itemKind === "product");
      expect(product.map((m) => m.qty).sort((a, b) => a - b)).toEqual([2, 30]);
      expect(moves.every((m) => m.occurredAt.getTime() === recordedAt.getTime())).toBe(true);
      expect(await stockOf(tx, i("Bolsa 0,5"))).toBe(bags - 30);
    });
  });
});

describe("cambio de estado sin señal (RF-20)", () => {
  it("reenviar el mismo cambio no repite el efecto ni falla por la transición ya hecha", async () => {
    await inRollback("jt", async (tx, userId) => {
      const run = await newRun(tx);
      const A = crypto.randomUUID();
      const recordedAt = new Date("2026-10-02T09:15:00-03:00");
      const payload = (clientId: string, over: Record<string, unknown> = {}) =>
        setRunStatusPayload.parse({
          runId: run.id,
          status: "in_progress",
          clientId,
          recordedAt: recordedAt.toISOString(),
          ...over,
        });
      const first = await setRunStatus(tx, payload(A), { clientId: A, recordedAt, userId });
      expect(first).toMatchObject({ status: "in_progress", duplicate: false });
      // el reenvío (se perdió la respuesta) no falla con "no se puede pasar de En elaboración a En elaboración"
      const again = await setRunStatus(tx, payload(A), { clientId: A, recordedAt, userId });
      expect(again).toMatchObject({ status: "in_progress", duplicate: true });

      // congelado sin señal: la hora de entrada al abatidor es la de la carga, no la de la sincronización
      const B = crypto.randomUUID();
      const frozen = await setRunStatus(tx, payload(B, { status: "freezing", freezerCodes: ["F1", "F2"] }), {
        clientId: B,
        recordedAt,
        userId,
      });
      expect(frozen.status).toBe("freezing");
      expect(frozen.frozenAt!.getTime()).toBe(recordedAt.getTime());
      // el reenvío tardío del primer cambio ya no puede hacer nada aunque la producción avanzó
      const late = await setRunStatus(tx, payload(A), { clientId: A, recordedAt, userId });
      expect(late).toMatchObject({ status: "freezing", duplicate: true });
      const log = await tx.query.productionStatusChanges.findMany({
        where: eq(schema.productionStatusChanges.runId, run.id),
      });
      expect(log.map((l) => l.status).sort()).toEqual(["freezing", "in_progress"]);
      expect(log.every((l) => l.changedById === userId)).toBe(true);
    });
  });

  it("congelado exige el abatidor también en el envío encolado", () => {
    const base = {
      runId: "00000000-0000-4000-8000-000000000001",
      status: "freezing",
      clientId: crypto.randomUUID(),
      recordedAt: new Date().toISOString(),
    };
    expect(setRunStatusPayload.safeParse(base).success).toBe(false);
    expect(setRunStatusPayload.safeParse({ ...base, freezerCodes: ["F2"] }).success).toBe(true);
  });
});
