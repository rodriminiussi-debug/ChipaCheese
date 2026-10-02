import { describe, expect, it } from "vitest";
import { and, eq, schema, type Executor } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { ingredientTotals, recordIngredientMovements } from "../stock/ledger";
import {
  createRunInput,
  recipeVersionInput,
  recordConsumptionsInput,
  recordPackingInput,
  recordWeighingsInput,
  savePlanInput,
  setRunStatusInput,
} from "./schemas";
import {
  activateRecipe,
  confirmPlan,
  consumptionSuggestions,
  createRecipeVersion,
  createRun,
  getActiveRecipe,
  getLotByCode,
  getPlan,
  getRun,
  listActiveRuns,
  listRecipeVersions,
  packingOptions,
  recordConsumptions,
  recordPacking,
  recordWeighings,
  runSummary,
  savePlan,
  setRunStatus,
  suggestPlan,
  weekPlan,
} from "./service";

const TODAY = "2026-10-02";
const SETTINGS = { capacityKg: 150, minBatchKg: 75 };

async function ids(db: Executor) {
  const users = await db.query.users.findMany();
  const ingredients = await db.query.ingredients.findMany();
  const products = await db.query.products.findMany();
  const locations = await db.query.locations.findMany();
  const u = (n: string) => users.find((x) => x.username === n)!.id;
  const i = (n: string) => ingredients.find((x) => x.name.startsWith(n))!.id;
  const p = (c: string) => products.find((x) => x.code === c)!.id;
  const l = (c: string) => locations.find((x) => x.code === c)!.id;
  return { u, i, p, l };
}

async function newRun(db: Executor, date = TODAY, today = TODAY) {
  const { u } = await ids(db);
  return createRun(db, createRunInput.parse({ date, responsibleId: u("af"), workerIds: [u("jt")] }), today);
}

async function stockOf(db: Executor, ingredientId: string) {
  return (await ingredientTotals(db))[ingredientId] ?? 0;
}

describe("receta maestra con versiones (RF-18)", () => {
  it("crea una versión borrador y al activarla archiva la vigente", async () => {
    await inRollback("af", async (tx) => {
      const v1 = (await getActiveRecipe(tx))!;
      expect(v1.version).toBe(1);
      const { i } = await ids(tx);
      const data = recipeVersionInput.parse({
        expectedYieldPerKgStarch: 2,
        deviationThresholdPct: 8,
        notes: "Menos leche",
        items: v1.items.map((it) => ({
          ingredientId: it.ingredientId,
          qtyPerKgStarch: it.ingredientId === i("Leche") ? 0.35 : it.qtyPerKgStarch,
          minPerKgStarch: it.minPerKgStarch,
          maxPerKgStarch: it.ingredientId === i("Leche") ? 0.35 : it.maxPerKgStarch,
          instructions: it.instructions,
        })),
      });
      const v2 = await createRecipeVersion(tx, data, TODAY);
      expect(v2).toMatchObject({ version: 2, status: "draft", notes: "Menos leche" });
      expect((await getActiveRecipe(tx))!.id).toBe(v1.id);

      await activateRecipe(tx, v2.id, TODAY);
      const history = await listRecipeVersions(tx);
      expect(history.map((r) => [r.version, r.status])).toEqual([
        [2, "active"],
        [1, "archived"],
      ]);
      const active = (await getActiveRecipe(tx))!;
      expect(active.effectiveFrom).toBe(TODAY);
      expect(active.items).toHaveLength(v1.items.length);
      expect(active.items.find((x) => x.ingredientId === i("Leche"))!.qtyPerKgStarch).toBe(0.35);
      // v1 conserva sus cantidades (las producciones ya hechas no cambian).
      await expect(activateRecipe(tx, v2.id, TODAY)).rejects.toThrow(/ya está activa/);
    });
  });

  it("puede activarse al guardar y valida rangos y repetidos", async () => {
    await inRollback("af", async (tx) => {
      const { i } = await ids(tx);
      const v = await createRecipeVersion(
        tx,
        recipeVersionInput.parse({
          expectedYieldPerKgStarch: 2,
          deviationThresholdPct: 10,
          notes: "Ajuste",
          activate: true,
          items: [{ ingredientId: i("Fécula"), qtyPerKgStarch: 1 }],
        }),
        TODAY,
      );
      expect(v.status).toBe("active");
      expect((await getActiveRecipe(tx))!.id).toBe(v.id);
    });
    expect(
      recipeVersionInput.safeParse({
        expectedYieldPerKgStarch: 2,
        deviationThresholdPct: 10,
        notes: "x y z",
        items: [
          { ingredientId: "a", qtyPerKgStarch: 1, minPerKgStarch: 2 },
          { ingredientId: "a", qtyPerKgStarch: 1 },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("plan diario sugerido (RF-19)", () => {
  it("convierte la demanda pendiente a kg por forma dentro de la ventana de N días", async () => {
    await inRollback("af", async (tx) => {
      // Demo: Club Náutico (confirmado, 05/10): 2 × lengüitas 5 kg + 1 × tapitas 5 kg. La Reina (09/10) queda afuera.
      const near = await suggestPlan(tx, { date: TODAY, windowDays: 3, ...SETTINGS });
      expect(near.pendingOrders.map((o) => o.customer)).toEqual(["Club Náutico", "Club Náutico"]);
      expect(near.demands.find((d) => d.shape === "lenguita")!.pendingKg).toBe(10);
      expect(near.demands.find((d) => d.shape === "tapita")!.pendingKg).toBe(5);
      expect(near.demands.find((d) => d.shape === "arito")!.pendingKg).toBe(0);

      // Con 7 días entra el pedido grande de La Reina: 425 bolsas de tapitas y de lengüitas = 212,5 kg c/u.
      const wide = await suggestPlan(tx, { date: TODAY, windowDays: 7, ...SETTINGS });
      expect(wide.demands.find((d) => d.shape === "tapita")!.pendingKg).toBe(217.5);
      expect(wide.demands.find((d) => d.shape === "lenguita")!.pendingKg).toBe(222.5);
    });
  });

  it("reparte el surtido en tres, excluye sándwich y respeta stock y mínimo", async () => {
    await inRollback("af", async (tx) => {
      const { p } = await ids(tx);
      const customer = (await tx.query.customers.findFirst())!;
      const before = await suggestPlan(tx, { date: TODAY, windowDays: 3, ...SETTINGS });
      const [order] = await tx
        .insert(schema.orders)
        .values({ customerId: customer.id, promisedDate: "2026-10-03", status: "received" })
        .returning();
      await tx.insert(schema.orderItems).values([
        { orderId: order!.id, productId: p("CH-SUR-500"), qtyUnits: 60, unitPrice: 4200 }, // 30 kg → 10 por forma
        { orderId: order!.id, productId: p("SW-JYQ"), qtyUnits: 100, unitPrice: 2600 }, // sándwich: fuera del plan
      ]);
      // Un pedido cancelado o ya despachado no cuenta.
      const [done] = await tx
        .insert(schema.orders)
        .values({ customerId: customer.id, promisedDate: "2026-10-03", status: "dispatched" })
        .returning();
      await tx
        .insert(schema.orderItems)
        .values({ orderId: done!.id, productId: p("CH-TAP-500"), qtyUnits: 1000, unitPrice: 1 });
      const after = await suggestPlan(tx, { date: TODAY, windowDays: 3, ...SETTINGS });
      for (const shape of ["tapita", "arito", "lenguita"]) {
        const b = before.demands.find((d) => d.shape === shape)!;
        const a = after.demands.find((d) => d.shape === shape)!;
        expect(a.pendingKg - b.pendingKg).toBeCloseTo(10, 6);
      }
      // Stock terminado de la demo: tapitas 160 bolsas = 80 kg (+ granel 6 × 5 kg repartido por forma).
      const tapita = after.demands.find((d) => d.shape === "tapita")!;
      expect(tapita.stockKg).toBeGreaterThan(80);
      expect(tapita.minStockKg).toBeGreaterThan(0);
      // La sugerencia sale de suggestDailyPlan: nunca supera la capacidad.
      expect(after.suggestion.totalKg).toBeLessThanOrEqual(150);
    });
  });

  it("guarda, edita y confirma el plan validando mínimo y capacidad (Regla 1)", async () => {
    await inRollback("af", async (tx) => {
      const save = (tapita: number, arito: number, lenguita: number) =>
        savePlan(
          tx,
          savePlanInput.parse({
            date: TODAY,
            items: [
              { shape: "tapita", kg: tapita },
              { shape: "arito", kg: arito },
              { shape: "lenguita", kg: lenguita },
            ],
          }),
        );
      const plan = await save(60, 10, 70);
      expect(plan).toMatchObject({ totalKg: 140, status: "draft" });
      expect(plan.items).toHaveLength(3);

      const confirmed = await confirmPlan(tx, TODAY, SETTINGS);
      expect(confirmed.status).toBe("confirmed");

      // Editar un plan confirmado lo devuelve a borrador y reemplaza los ítems.
      const edited = await save(100, 20, 60);
      expect(edited).toMatchObject({ totalKg: 180, status: "draft" });
      expect(edited.items).toHaveLength(3);
      await expect(confirmPlan(tx, TODAY, SETTINGS)).rejects.toThrow(/supera la capacidad/);

      await save(20, 10, 10);
      await expect(confirmPlan(tx, TODAY, SETTINGS)).rejects.toThrow(/mínimo/);

      await save(0, 0, 0); // 0 kg es una carga válida: no se produce
      expect((await confirmPlan(tx, TODAY, SETTINGS)).status).toBe("confirmed");
      expect((await getPlan(tx, TODAY))!.items.every((it) => it.kg === 0)).toBe(true);

      await expect(confirmPlan(tx, "2026-12-24", SETTINGS)).rejects.toThrow(/Primero guardá/);
    });
  });

  it("vista semanal: kg planificados y pesados por día", async () => {
    await inRollback("af", async (tx) => {
      await savePlan(
        tx,
        savePlanInput.parse({
          date: "2026-10-01",
          items: [
            { shape: "tapita", kg: 100 },
            { shape: "arito", kg: 0 },
            { shape: "lenguita", kg: 30 },
          ],
        }),
      );
      const week = await weekPlan(tx, TODAY, [1, 2, 3, 4, 5]);
      expect(week.map((d) => d.date)).toEqual([
        "2026-09-28",
        "2026-09-29",
        "2026-09-30",
        "2026-10-01",
        "2026-10-02",
      ]);
      const thu = week.find((d) => d.date === "2026-10-01")!;
      expect(thu).toMatchObject({ plannedKg: 130, planStatus: "draft", runs: 1 });
      expect(thu.weighedKg).toBeCloseTo(149.3, 3); // producción de la demo del 01/10: 72,4 + 9,8 + 67,1
      expect(week.find((d) => d.date === "2026-09-29")).toMatchObject({
        plannedKg: 0,
        planStatus: null,
        runs: 0,
      });
    });
  });
});

describe("registro de producción (RF-20)", () => {
  it("numera las producciones del día y marca la carga tardía", async () => {
    await inRollback("af", async (tx) => {
      const first = await newRun(tx);
      const second = await newRun(tx);
      expect([first.runNumber, second.runNumber]).toEqual([1, 2]);
      expect(first).toMatchObject({ status: "planned", starchKg: 75, batches: 2, lateEntry: false });
      const past = await newRun(tx, "2026-09-30");
      expect(past).toMatchObject({ runNumber: 1, lateEntry: true });
      const full = (await getRun(tx, first.id))!;
      expect(full.workers).toHaveLength(1);
      expect((await listActiveRuns(tx, TODAY)).map((r) => r.id)).toContain(first.id);
    });
  });

  it("vincula el plan del día y exige receta no borrador", async () => {
    await inRollback("af", async (tx) => {
      const plan = await savePlan(
        tx,
        savePlanInput.parse({ date: TODAY, items: [{ shape: "tapita", kg: 100 }] }),
      );
      expect((await newRun(tx)).planId).toBe(plan.id);
      const { u } = await ids(tx);
      const draft = await createRecipeVersion(
        tx,
        recipeVersionInput.parse({
          expectedYieldPerKgStarch: 2,
          deviationThresholdPct: 10,
          notes: "borrador",
          items: [{ ingredientId: (await ids(tx)).i("Fécula"), qtyPerKgStarch: 1 }],
        }),
        TODAY,
      );
      await expect(
        createRun(
          tx,
          createRunInput.parse({ date: TODAY, recipeId: draft.id, responsibleId: u("af") }),
          TODAY,
        ),
      ).rejects.toThrow(/borrador/);
    });
  });

  it("precarga el teórico y sugiere lotes por FEFO", async () => {
    await inRollback("af", async (tx, userId) => {
      const { i, l } = await ids(tx);
      // Segundo lote de queso barra que vence ANTES que el de la demo (15/11) con poco stock.
      const [early] = await tx
        .insert(schema.rawLots)
        .values({
          ingredientId: i("Queso barra"),
          supplierLotCode: "TYBO-EARLY",
          expiryDate: "2026-10-20",
          receivedQty: 10,
          locationId: l("HELADERA"),
        })
        .returning();
      await recordIngredientMovements(tx, userId, [
        {
          type: "receipt",
          ingredientId: i("Queso barra"),
          rawLotId: early!.id,
          locationId: l("HELADERA"),
          qty: 10,
        },
      ]);
      const run = (await getRun(tx, (await newRun(tx)).id))!;
      const sug = await consumptionSuggestions(tx, run);
      const queso = sug.find((s) => s.ingredientId === i("Queso barra"))!;
      expect(queso.theoretical).toBe(22.5);
      expect(queso.min).toBeCloseTo(21.975, 3); // 0,293 por kg (numeric de 3 decimales) × 75
      expect(queso.max).toBe(22.5);
      // FEFO: primero los 10 kg del lote que vence antes, el resto del lote de la demo.
      expect(queso.lines).toHaveLength(2);
      expect(queso.lines[0]).toEqual({ rawLotId: early!.id, qty: 10 });
      expect(queso.lines[1]!.qty).toBe(12.5);
      expect(queso.lots[0]!.code).toBe("TYBO-EARLY");
      const fecula = sug.find((s) => s.ingredientId === i("Fécula"))!;
      expect(fecula.theoretical).toBe(75);
      expect(fecula.lines).toHaveLength(1);
    });
  });

  it("confirma consumos: filas real vs teórico, fuera de rango y movimientos negativos por lote", async () => {
    await inRollback("af", async (tx, userId) => {
      const { i, l } = await ids(tx);
      const run = await newRun(tx);
      const full = (await getRun(tx, run.id))!;
      const sug = await consumptionSuggestions(tx, full);
      const lines = sug.flatMap((s) =>
        s.lines.map((ln) => ({
          ingredientId: s.ingredientId,
          rawLotId: ln.rawLotId,
          // Leche 31 L (rango 18–30): fuera de rango. El resto, el teórico.
          qty: s.ingredientId === i("Leche") ? 31 : ln.qty,
        })),
      );
      const before = await stockOf(tx, i("Leche"));
      const res = await recordConsumptions(
        tx,
        userId,
        recordConsumptionsInput.parse({ runId: run.id, lines }),
      );
      expect(res.outOfRange).toBe(1);

      const after = (await getRun(tx, run.id))!;
      expect(after.status).toBe("in_progress");
      expect(after.consumptions).toHaveLength(7);
      const leche = after.consumptions.find((c) => c.ingredientId === i("Leche"))!;
      expect(leche).toMatchObject({ qtyTheoretical: 30, qtyActual: 31, outOfRange: true });
      expect(after.consumptions.filter((c) => c.outOfRange)).toHaveLength(1);
      expect(after.consumptions.find((c) => c.ingredientId === i("Fécula"))!.rawLot!.supplierLotCode).toBe(
        "FEC-2609",
      );

      // Movimientos negativos, ubicación = la del lote, vinculados a la producción.
      const moves = await tx.query.stockMovements.findMany({
        where: and(
          eq(schema.stockMovements.refTable, "production_runs"),
          eq(schema.stockMovements.refId, run.id),
        ),
      });
      expect(moves).toHaveLength(7);
      expect(moves.every((m) => m.type === "production_consumption" && m.qty < 0)).toBe(true);
      const mLeche = moves.find((m) => m.ingredientId === i("Leche"))!;
      expect(mLeche).toMatchObject({ qty: -31, locationId: l("HELADERA") });
      expect(mLeche.rawLotId).toBe(leche.rawLotId);
      expect(moves.find((m) => m.ingredientId === i("Fécula"))!.locationId).toBe(l("DEP-SECO"));
      expect(await stockOf(tx, i("Leche"))).toBe(before - 31);
    });
  });

  it("al reconfirmar reemplaza los consumos con movimientos compensatorios", async () => {
    await inRollback("af", async (tx, userId) => {
      const { i } = await ids(tx);
      const run = await newRun(tx);
      const lecheLot = (await tx.query.rawLots.findFirst({
        where: eq(schema.rawLots.ingredientId, i("Leche")),
      }))!;
      const record = (qty: number) =>
        recordConsumptions(
          tx,
          userId,
          recordConsumptionsInput.parse({
            runId: run.id,
            lines: [{ ingredientId: i("Leche"), rawLotId: lecheLot.id, qty }],
          }),
        );
      const before = await stockOf(tx, i("Leche"));
      await record(28);
      await record(24);
      expect(await stockOf(tx, i("Leche"))).toBe(before - 24);
      const rows = (await getRun(tx, run.id))!.consumptions;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.qtyActual).toBe(24);
    });
  });

  it("valida lote del insumo, cantidad y estado", async () => {
    await inRollback("af", async (tx, userId) => {
      const { i } = await ids(tx);
      const run = await newRun(tx);
      const feculaLot = (await tx.query.rawLots.findFirst({
        where: eq(schema.rawLots.ingredientId, i("Fécula")),
      }))!;
      await expect(
        recordConsumptions(
          tx,
          userId,
          recordConsumptionsInput.parse({
            runId: run.id,
            lines: [{ ingredientId: i("Leche"), rawLotId: feculaLot.id, qty: 5 }],
          }),
        ),
      ).rejects.toThrow(/lote elegido/);
      await expect(
        recordConsumptions(
          tx,
          userId,
          recordConsumptionsInput.parse({ runId: run.id, lines: [{ ingredientId: i("Leche"), qty: 0 }] }),
        ),
      ).rejects.toThrow(/al menos un consumo/);
      await expect(
        recordConsumptions(
          tx,
          userId,
          recordConsumptionsInput.parse({ runId: run.id, lines: [{ ingredientId: i("Bolsa 0,5"), qty: 3 }] }),
        ),
      ).rejects.toThrow(/no pertenece a la receta/);
    });
  });

  it("recorre el flujo de estados con transiciones válidas", async () => {
    await inRollback("af", async (tx, userId) => {
      const { p, l } = await ids(tx);
      const run = await newRun(tx);
      const status = (s: "in_progress" | "freezing" | "packed" | "closed" | "cancelled", extra = {}) =>
        setRunStatus(tx, setRunStatusInput.parse({ runId: run.id, status: s, ...extra }));
      await expect(status("freezing", { freezerCodes: ["F1"] })).rejects.toThrow(/No se puede pasar/);
      await status("in_progress");
      expect(setRunStatusInput.safeParse({ runId: run.id, status: "freezing" }).success).toBe(false);
      const frozen = await status("freezing", { freezerCodes: ["F1", "F2"], frozenTime: "21:30" });
      expect(frozen.freezerCodes).toEqual(["F1", "F2"]);
      expect(frozen.frozenAt!.toISOString()).toBe("2026-10-03T00:30:00.000Z"); // 21:30 hora argentina
      await expect(status("packed")).rejects.toThrow(/Cargá el envasado/);
      await recordPacking(
        tx,
        userId,
        recordPackingInput.parse({
          runId: run.id,
          items: [{ productId: p("CH-TAP-500"), units: 10, locationId: l("F3") }],
        }),
      );
      expect((await status("packed")).status).toBe("packed");
      expect((await status("closed")).status).toBe("closed");
      await expect(status("cancelled")).rejects.toThrow(/No se puede pasar/);
    });
  });
});

describe("pesadas y rendimiento (RF-21)", () => {
  it("suma pesadas por forma y calcula rendimiento, merma y bolsas", async () => {
    await inRollback("af", async (tx, userId) => {
      const run = await newRun(tx);
      await expect(
        recordWeighings(
          tx,
          userId,
          recordWeighingsInput.parse({ runId: run.id, items: [{ shape: "tapita", kg: 5 }] }),
        ),
      ).rejects.toThrow(/No se puede cargar pesadas/);
      await setRunStatus(tx, setRunStatusInput.parse({ runId: run.id, status: "in_progress" }));
      await recordWeighings(
        tx,
        userId,
        recordWeighingsInput.parse({
          runId: run.id,
          items: [
            { shape: "tapita", kg: "70,6" },
            { shape: "arito", kg: 10.1 },
            { shape: "lenguita", kg: 68.6 },
          ],
        }),
      );
      const s = runSummary((await getRun(tx, run.id))!);
      expect(s.weighedKg).toBe(149.3);
      expect(s.byShape).toEqual({ tapita: 70.6, arito: 10.1, lenguita: 68.6 });
      // Sin consumos cargados: denominador teórico de la receta v1 (177,75 kg para 75 kg de fécula).
      expect(s.ingredientsSource).toBe("theoretical");
      expect(s.ingredientsKg).toBeCloseTo(177.75, 3);
      expect(s.yieldRatio).toBeCloseTo(0.8399, 4);
      expect(s.lossKg).toBeCloseTo(28.45, 3);
      expect(s.bags).toBeCloseTo(298.6, 3);
      expect(s.expectedKgPerKgStarch).toBe(1.99);
      expect(s.kgPerKgStarch).toBeCloseTo(1.991, 3);
      await expect(
        recordWeighings(
          tx,
          userId,
          recordWeighingsInput.parse({ runId: run.id, items: [{ shape: "arito", kg: 0 }] }),
        ),
      ).rejects.toThrow(/mayor a cero/);
    });
  });
});

describe("envasado, lote y stock (RF-22)", () => {
  it("crea el lote AAMMDD-N, suma stock de producto y descuenta envases sin lote del depósito seco", async () => {
    await inRollback("af", async (tx, userId) => {
      const { p, l, i } = await ids(tx);
      const run = await newRun(tx);
      await setRunStatus(tx, setRunStatusInput.parse({ runId: run.id, status: "in_progress" }));
      const bags500 = await stockOf(tx, i("Bolsa 0,5"));
      const bags5k = await stockOf(tx, i("Bolsa granel"));

      const { lot, packings } = await recordPacking(
        tx,
        userId,
        recordPackingInput.parse({
          runId: run.id,
          items: [
            { productId: p("CH-TAP-500"), units: 100, locationId: l("F3") },
            { productId: p("CH-LEN-5K"), units: 4, locationId: l("F4") },
          ],
        }),
      );
      expect(lot).toMatchObject({
        code: "261002-1",
        productionDate: TODAY,
        expiryDate: "2027-04-02",
        runId: run.id,
      });
      expect(packings.map((x) => [x.units, x.kg])).toEqual([
        [100, 50],
        [4, 20],
      ]);

      // Segundo envasado de la misma producción: reutiliza el lote.
      const again = await recordPacking(
        tx,
        userId,
        recordPackingInput.parse({
          runId: run.id,
          items: [{ productId: p("CH-TAP-500"), units: 20, locationId: l("F3") }],
        }),
      );
      expect(again.lot.id).toBe(lot.id);

      const detail = (await getLotByCode(tx, "261002-1"))!;
      expect(detail.packings).toHaveLength(3);
      const stock = Object.fromEntries(
        detail.stock.map((s) => [`${s.productName}@${s.locationCode}`, s.qty]),
      );
      expect(stock).toEqual({ "Chipá tapitas 0,5 kg@F3": 120, "Chipá lengüitas granel 5 kg@F4": 4 });

      // Movimientos: producto entra (+) con el lote; envases salen (−) del depósito seco sin lote.
      const outputs = await tx.query.stockMovements.findMany({
        where: and(
          eq(schema.stockMovements.finishedLotId, lot.id),
          eq(schema.stockMovements.type, "production_output"),
        ),
      });
      expect(outputs.map((m) => m.qty).sort((a, b) => a - b)).toEqual([4, 20, 100]);
      const packaging = await tx.query.stockMovements.findMany({
        where: and(
          eq(schema.stockMovements.refTable, "packings"),
          eq(schema.stockMovements.type, "production_consumption"),
        ),
      });
      expect(packaging.every((m) => m.qty < 0 && m.rawLotId === null && m.locationId === l("DEP-SECO"))).toBe(
        true,
      );
      expect(await stockOf(tx, i("Bolsa 0,5"))).toBe(bags500 - 120);
      expect(await stockOf(tx, i("Bolsa granel"))).toBe(bags5k - 4);
    });
  });

  it("valida ubicación, estado y lote retenido", async () => {
    await inRollback("af", async (tx, userId) => {
      const { p, l } = await ids(tx);
      const run = await newRun(tx);
      const pack = (locationCode: string) =>
        recordPacking(
          tx,
          userId,
          recordPackingInput.parse({
            runId: run.id,
            items: [{ productId: p("CH-ARI-500"), units: 5, locationId: l(locationCode) }],
          }),
        );
      await expect(pack("F3")).rejects.toThrow(/No se puede cargar envasado/); // todavía planificada
      await setRunStatus(tx, setRunStatusInput.parse({ runId: run.id, status: "in_progress" }));
      await expect(pack("LOCAL")).rejects.toThrow(/F3 o F4/);
      const { lot } = await pack("F3");
      await tx.update(schema.finishedLots).set({ onHold: true }).where(eq(schema.finishedLots.id, lot.id));
      await expect(pack("F3")).rejects.toThrow(/retenido/);
      const opts = await packingOptions(tx);
      expect(opts.locations.map((x) => x.code)).toEqual(["F3", "F4"]);
      expect(opts.products.some((x) => x.shape === "pizzeta")).toBe(false);
    });
  });
});
