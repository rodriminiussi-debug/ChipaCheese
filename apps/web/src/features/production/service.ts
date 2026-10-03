import {
  addDays,
  allocateFefo,
  isoWeekday,
  finishedLotCode,
  finishedLotExpiry,
  recipeIngredientsKg,
  roundQty,
  suggestDailyPlan,
  validateDailyLoad,
  type IsoDate,
  type LotBalance,
  type RecipeLine,
  CONSUMPTION_STATUSES,
  PACKING_STATUSES,
  PLAN_SHAPES,
  WEIGHING_STATUSES,
  buildConsumptionRows,
  buildShapeDemands,
  canTransitionRun,
  summarizeRun,
  weekDays,
  type RunStatus,
} from "@chipa/domain";
import { and, asc, desc, eq, gte, inArray, lte, ne, schema, sql, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import {
  locationByCode,
  rawLotBalances,
  recordIngredientMovements,
  recordProductMovements,
  type IngredientMovement,
  type ProductMovement,
} from "@/features/stock/ledger";
import { RUN_STATUS } from "./labels";
import type {
  CreateRunData,
  RecordConsumptionsInput,
  RecordPackingInput,
  RecordWeighingsInput,
  RecipeVersionData,
  SavePlanData,
  SetRunStatusInput,
} from "./schemas";

/**
 * Servicio de producción (M4). Funciones `(db: Executor, …)` testeables con `inRollback`.
 * TODO movimiento de stock pasa por el libro mayor (`features/stock/ledger.ts`).
 */

// ===========================================================================================
// RF-18 · Receta maestra
// ===========================================================================================

const recipeWith = { items: { with: { ingredient: true } } } as const;

/** Los ítems de receta vuelven en el orden de la ficha (sortOrder). */
function sorted<T extends { items: { sortOrder: number }[] }>(recipe: T | undefined): T | undefined {
  recipe?.items.sort((a, b) => a.sortOrder - b.sortOrder);
  return recipe;
}

export async function getActiveRecipe(db: Executor) {
  return sorted(
    await db.query.recipes.findFirst({
      where: eq(schema.recipes.status, "active"),
      orderBy: desc(schema.recipes.version),
      with: recipeWith,
    }),
  );
}

export async function getRecipe(db: Executor, id: string) {
  return sorted(await db.query.recipes.findFirst({ where: eq(schema.recipes.id, id), with: recipeWith }));
}

/** Historial de versiones, la más nueva primero. */
export function listRecipeVersions(db: Executor) {
  return db.query.recipes.findMany({ orderBy: desc(schema.recipes.version) });
}
export type RecipeWithItems = NonNullable<Awaited<ReturnType<typeof getRecipe>>>;

export const recipeLines = (r: RecipeWithItems): RecipeLine[] =>
  r.items.map((i) => ({
    ingredientId: i.ingredientId,
    qtyPerKgStarch: i.qtyPerKgStarch,
    minPerKgStarch: i.minPerKgStarch,
    maxPerKgStarch: i.maxPerKgStarch,
  }));

/** Insumos que pueden entrar en una receta (no envases). */
export async function recipeIngredientOptions(db: Executor) {
  const rows = await db.query.ingredients.findMany({
    where: and(eq(schema.ingredients.active, true), ne(schema.ingredients.category, "packaging")),
    orderBy: asc(schema.ingredients.name),
  });
  return rows.map((i) => ({ id: i.id, name: i.name, unit: i.unit }));
}

/**
 * Crea una nueva versión (borrador, o activa si `activate`). El número es el siguiente de la receta vigente.
 * Una versión se guarda siempre como copia nueva: nunca se edita una versión ya usada en producciones.
 */
export async function createRecipeVersion(db: Executor, input: RecipeVersionData, today: IsoDate) {
  const base =
    (await getActiveRecipe(db)) ??
    (await db.query.recipes.findFirst({ orderBy: desc(schema.recipes.version) }));
  const name = base?.name ?? "Masa de chipá";
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${schema.recipes.version}), 0)`.mapWith(Number) })
    .from(schema.recipes)
    .where(eq(schema.recipes.name, name));
  const ids = input.items.map((i) => i.ingredientId);
  const found = await db
    .select({ id: schema.ingredients.id })
    .from(schema.ingredients)
    .where(inArray(schema.ingredients.id, ids));
  if (found.length !== new Set(ids).size) throw new UserError("Algún insumo de la receta no existe.");

  const [recipe] = await db
    .insert(schema.recipes)
    .values({
      name,
      version: (max ?? 0) + 1,
      status: "draft",
      expectedYieldPerKgStarch: input.expectedYieldPerKgStarch,
      deviationThresholdPct: input.deviationThresholdPct,
      notes: input.notes,
    })
    .returning();
  await db.insert(schema.recipeItems).values(
    input.items.map((it, i) => ({
      recipeId: recipe!.id,
      ingredientId: it.ingredientId,
      qtyPerKgStarch: it.qtyPerKgStarch,
      minPerKgStarch: it.minPerKgStarch,
      maxPerKgStarch: it.maxPerKgStarch,
      instructions: it.instructions,
      sortOrder: i,
    })),
  );
  if (input.activate) return activateRecipe(db, recipe!.id, today);
  return recipe!;
}

/** Activa una versión: la vigente pasa a archivada. */
export async function activateRecipe(db: Executor, id: string, today: IsoDate) {
  const target = await db.query.recipes.findFirst({ where: eq(schema.recipes.id, id) });
  if (!target) throw new UserError("La receta no existe.");
  if (target.status === "active") throw new UserError("Esa versión ya está activa.");
  await db.update(schema.recipes).set({ status: "archived" }).where(eq(schema.recipes.status, "active"));
  const [row] = await db
    .update(schema.recipes)
    .set({ status: "active", effectiveFrom: today })
    .where(eq(schema.recipes.id, id))
    .returning();
  return row!;
}

// ===========================================================================================
// RF-19 · Plan diario y semanal
// ===========================================================================================

const PENDING_ORDER_STATUSES = ["received", "confirmed", "in_production"] as const;

export interface PlanSettings {
  capacityKg: number;
  minBatchKg: number;
}

/**
 * Demanda pendiente: pedidos recibidos/confirmados/en producción con fecha comprometida dentro de
 * `windowDays` días desde `date` (incluye los atrasados), en kg por forma.
 */
export async function pendingOrderLines(db: Executor, date: IsoDate, windowDays: number) {
  return db
    .select({
      orderId: schema.orders.id,
      number: schema.orders.number,
      customer: schema.customers.legalName,
      promisedDate: schema.orders.promisedDate,
      status: schema.orders.status,
      productName: schema.products.name,
      shape: schema.products.shape,
      netWeightKg: schema.products.netWeightKg,
      units: schema.orderItems.qtyUnits,
    })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .innerJoin(schema.products, eq(schema.products.id, schema.orderItems.productId))
    .innerJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
    .where(
      and(
        inArray(schema.orders.status, [...PENDING_ORDER_STATUSES]),
        lte(schema.orders.promisedDate, addDays(date, windowDays)),
      ),
    )
    .orderBy(asc(schema.orders.promisedDate), asc(schema.orders.number));
}

/** Plan sugerido por `suggestDailyPlan` (dominio) con el detalle de pendiente / stock / mínimo por forma. */
export async function suggestPlan(db: Executor, input: { date: IsoDate; windowDays: number } & PlanSettings) {
  const [pending, stock, minStock] = await Promise.all([
    pendingOrderLines(db, input.date, input.windowDays),
    db
      .select({
        shape: schema.products.shape,
        netWeightKg: schema.products.netWeightKg,
        units: sql<number>`sum(${schema.productStock.qty})`.mapWith(Number),
      })
      .from(schema.productStock)
      .innerJoin(schema.products, eq(schema.products.id, schema.productStock.productId))
      .groupBy(schema.products.id),
    db
      .select({
        shape: schema.products.shape,
        netWeightKg: schema.products.netWeightKg,
        units: schema.products.minStockUnits,
      })
      .from(schema.products)
      .where(and(eq(schema.products.active, true), gte(schema.products.minStockUnits, 1))),
  ]);
  const demands = buildShapeDemands({ pending, stock, minStock });
  const suggestion = suggestDailyPlan({
    demands,
    capacityKg: input.capacityKg,
    minBatchKg: input.minBatchKg,
  });
  return {
    date: input.date,
    windowDays: input.windowDays,
    demands,
    suggestion,
    pendingOrders: pending.map((p) => ({
      orderId: p.orderId,
      number: p.number,
      customer: p.customer,
      promisedDate: p.promisedDate,
      status: p.status,
      productName: p.productName,
      units: p.units,
      kg: roundQty(p.units * p.netWeightKg),
    })),
  };
}

export function getPlan(db: Executor, date: IsoDate) {
  return db.query.productionPlans.findFirst({
    where: eq(schema.productionPlans.date, date),
    with: { items: true },
  });
}

/** Guarda (crea o reemplaza) el plan de un día. Siempre vuelve a borrador: hay que confirmarlo de nuevo. */
export async function savePlan(db: Executor, input: SavePlanData) {
  const existing = await getPlan(db, input.date);
  if (existing?.status === "done")
    throw new UserError("El plan de ese día ya se cumplió y no se puede editar.");
  const byShape = new Map<string, number>(PLAN_SHAPES.map((s) => [s, 0]));
  for (const it of input.items) byShape.set(it.shape, roundQty(it.kg));
  const totalKg = roundQty([...byShape.values()].reduce((a, b) => a + b, 0));

  let planId: string;
  if (existing) {
    planId = existing.id;
    await db
      .update(schema.productionPlans)
      .set({ totalKg, notes: input.notes, status: "draft" })
      .where(eq(schema.productionPlans.id, planId));
    await db.delete(schema.productionPlanItems).where(eq(schema.productionPlanItems.planId, planId));
  } else {
    const [row] = await db
      .insert(schema.productionPlans)
      .values({ date: input.date, totalKg, notes: input.notes })
      .returning();
    planId = row!.id;
  }
  await db.insert(schema.productionPlanItems).values(
    [...byShape.entries()].map(([shape, kg]) => ({
      planId,
      shape: shape as (typeof PLAN_SHAPES)[number],
      kg,
    })),
  );
  return (await getPlan(db, input.date))!;
}

/** Confirma el plan: la carga del día debe respetar el mínimo por tanda y la capacidad (Regla 1). */
export async function confirmPlan(db: Executor, date: IsoDate, settings: PlanSettings) {
  const plan = await getPlan(db, date);
  if (!plan) throw new UserError("Primero guardá el plan de ese día.");
  if (plan.status === "done") throw new UserError("El plan de ese día ya se cumplió.");
  const check = validateDailyLoad(plan.totalKg, settings.capacityKg, settings.minBatchKg);
  if (!check.ok) {
    throw new UserError(
      check.reason === "over_capacity"
        ? `El plan (${plan.totalKg} kg) supera la capacidad diaria de ${settings.capacityKg} kg del abatidor.`
        : `El plan (${plan.totalKg} kg) no llega al mínimo de ${settings.minBatchKg} kg por tanda.`,
      { totalKg: [check.reason ?? "invalid"] },
    );
  }
  const [row] = await db
    .update(schema.productionPlans)
    .set({ status: "confirmed" })
    .where(eq(schema.productionPlans.id, plan.id))
    .returning();
  return row!;
}

/** Vista semanal: kg planificados por día (y lo pesado) para comparar con la capacidad. */
export async function weekPlan(db: Executor, date: IsoDate, workdays: number[]) {
  // Se consultan los 7 días: los no hábiles solo se muestran si tienen plan o producciones.
  const days = weekDays(date, [1, 2, 3, 4, 5, 6, 7]);
  const [plans, weighed] = await Promise.all([
    db.query.productionPlans.findMany({ where: inArray(schema.productionPlans.date, days) }),
    db
      .select({
        date: schema.productionRuns.date,
        runs: sql<number>`count(distinct ${schema.productionRuns.id})`.mapWith(Number),
        kg: sql<number>`coalesce(sum(${schema.productionWeighings.kg}), 0)`.mapWith(Number),
      })
      .from(schema.productionRuns)
      .leftJoin(schema.productionWeighings, eq(schema.productionWeighings.runId, schema.productionRuns.id))
      .where(and(inArray(schema.productionRuns.date, days), ne(schema.productionRuns.status, "cancelled")))
      .groupBy(schema.productionRuns.date),
  ]);
  return days
    .map((d) => {
      const plan = plans.find((p) => p.date === d);
      const w = weighed.find((x) => x.date === d);
      return {
        date: d,
        plannedKg: plan?.totalKg ?? 0,
        planStatus: plan?.status ?? null,
        runs: w?.runs ?? 0,
        weighedKg: roundQty(w?.kg ?? 0),
      };
    })
    .filter((d) => workdays.includes(isoWeekday(d.date)) || d.plannedKg > 0 || d.runs > 0);
}

// ===========================================================================================
// RF-20 · Registro de producción
// ===========================================================================================

const runWith = {
  recipe: { with: recipeWith },
  plan: true,
  responsible: true,
  supervisor: true,
  workers: { with: { user: true } },
  consumptions: { with: { ingredient: true, rawLot: true } },
  weighings: true,
  lots: { with: { packings: { with: { product: true, location: true } } } },
} as const;

export async function getRun(db: Executor, id: string) {
  const run = await db.query.productionRuns.findFirst({
    where: eq(schema.productionRuns.id, id),
    with: runWith,
  });
  if (run) sorted(run.recipe);
  return run;
}
export type RunDetail = NonNullable<Awaited<ReturnType<typeof getRun>>>;

export async function listRuns(db: Executor, f: { from?: IsoDate; to?: IsoDate; limit?: number } = {}) {
  return db.query.productionRuns.findMany({
    where: and(
      f.from ? gte(schema.productionRuns.date, f.from) : undefined,
      f.to ? lte(schema.productionRuns.date, f.to) : undefined,
    ),
    orderBy: [desc(schema.productionRuns.date), desc(schema.productionRuns.runNumber)],
    limit: f.limit ?? 20,
    with: { responsible: true, lots: true, weighings: true },
  });
}

/** Producciones abiertas (planta): las de hoy y las que siguen en curso de los últimos días. */
export async function listActiveRuns(db: Executor, today: IsoDate) {
  return db.query.productionRuns.findMany({
    where: and(
      inArray(schema.productionRuns.status, ["planned", "in_progress", "freezing", "packed"]),
      gte(schema.productionRuns.date, addDays(today, -7)),
    ),
    orderBy: [desc(schema.productionRuns.date), desc(schema.productionRuns.runNumber)],
    with: { lots: true },
  });
}

/** Personal que puede figurar en una producción (planta y jefatura). */
export async function plantStaffOptions(db: Executor) {
  const rows = await db.query.users.findMany({
    where: and(eq(schema.users.active, true), inArray(schema.users.role, ["operator", "production_manager"])),
    orderBy: asc(schema.users.name),
  });
  return rows.map((u) => ({ id: u.id, name: u.name, initials: u.initials, role: u.role }));
}

export async function runFormOptions(db: Executor) {
  const [users, recipe] = await Promise.all([plantStaffOptions(db), getActiveRecipe(db)]);
  return { users, recipe: recipe ? { id: recipe.id, name: recipe.name, version: recipe.version } : null };
}
export type RunFormOptions = Awaited<ReturnType<typeof runFormOptions>>;

export async function createRun(db: Executor, input: CreateRunData, today: IsoDate) {
  const recipe = input.recipeId ? await getRecipe(db, input.recipeId) : await getActiveRecipe(db);
  if (!recipe) throw new UserError(input.recipeId ? "La receta no existe." : "No hay una receta activa.");
  if (recipe.status === "draft") throw new UserError("La receta elegida es un borrador: activala primero.");

  const peopleIds = [
    input.responsibleId,
    ...(input.supervisorId ? [input.supervisorId] : []),
    ...input.workerIds,
  ];
  const people = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.id, peopleIds));
  if (people.length !== new Set(peopleIds).size)
    throw new UserError("Alguna de las personas elegidas no existe.");

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${schema.productionRuns.runNumber}), 0)`.mapWith(Number) })
    .from(schema.productionRuns)
    .where(eq(schema.productionRuns.date, input.date));
  const plan = await getPlan(db, input.date);

  const [run] = await db
    .insert(schema.productionRuns)
    .values({
      date: input.date,
      runNumber: (max ?? 0) + 1,
      shift: input.shift,
      recipeId: recipe.id,
      planId: plan?.id ?? null,
      starchKg: input.starchKg,
      batches: input.batches,
      status: "planned",
      responsibleId: input.responsibleId,
      supervisorId: input.supervisorId,
      lateEntry: input.date < today,
      notes: input.notes,
    })
    .returning();
  const workers = [...new Set(input.workerIds)];
  if (workers.length) {
    await db
      .insert(schema.productionRunWorkers)
      .values(workers.map((userId) => ({ runId: run!.id, userId })));
  }
  return run!;
}

function assertStatus(run: { status: RunStatus }, allowed: RunStatus[], what: string) {
  if (!allowed.includes(run.status)) {
    throw new UserError(
      `No se puede cargar ${what} en una producción ${RUN_STATUS[run.status]?.label.toLowerCase()}.`,
    );
  }
}

async function requireRun(db: Executor, id: string) {
  const run = await getRun(db, id);
  if (!run) throw new UserError("La producción no existe.");
  return run;
}

/** Lotes de materia prima con saldo, ordenados FEFO, y la sugerencia de consumo para el teórico de la receta. */
export async function consumptionSuggestions(db: Executor, run: RunDetail) {
  const out = [];
  for (const item of run.recipe.items) {
    const theoretical = roundQty(item.qtyPerKgStarch * run.starchKg);
    const lots = (await rawLotBalances(db, item.ingredientId)).filter((l) => l.rawLotId);
    const positions: LotBalance[] = lots.map((l) => ({
      lotId: l.rawLotId!,
      expiryDate: l.expiryDate ?? "9999-12-31",
      qty: l.qty,
    }));
    const { allocations, shortfall } = allocateFefo(positions, theoretical);
    const lines = allocations.map((a) => ({ rawLotId: a.lotId as string | null, qty: a.qty }));
    if (shortfall > 0 || lines.length === 0)
      lines.push({ rawLotId: null, qty: shortfall > 0 ? shortfall : theoretical });
    out.push({
      ingredientId: item.ingredientId,
      name: item.ingredient.name,
      unit: item.ingredient.unit,
      theoretical,
      min: item.minPerKgStarch == null ? null : roundQty(item.minPerKgStarch * run.starchKg),
      max: item.maxPerKgStarch == null ? null : roundQty(item.maxPerKgStarch * run.starchKg),
      available: roundQty(lots.reduce((a, l) => a + l.qty, 0)),
      lots: lots.map((l) => ({
        rawLotId: l.rawLotId!,
        code: l.supplierLotCode ?? "s/lote",
        expiryDate: l.expiryDate,
        qty: l.qty,
      })),
      lines,
    });
  }
  return out;
}
export type ConsumptionSuggestion = Awaited<ReturnType<typeof consumptionSuggestions>>[number];

/**
 * Confirma los consumos reales. Inserta `production_consumptions` (teórico vs real, fuera de rango) y
 * movimientos negativos `production_consumption` en la ubicación de cada lote. Si ya había consumos
 * cargados se revierten con movimientos compensatorios (el libro mayor no se edita) y se reemplazan.
 */
export async function recordConsumptions(
  db: Executor,
  userId: string | null,
  input: RecordConsumptionsInput,
) {
  const run = await requireRun(db, input.runId);
  assertStatus(run, CONSUMPTION_STATUSES, "consumos");
  const entries = input.lines.map((l) => ({
    ingredientId: l.ingredientId,
    rawLotId: (l.rawLotId as string | null | undefined) ?? null,
    qty: typeof l.qty === "number" ? l.qty : Number(l.qty),
  }));
  let rows;
  try {
    rows = buildConsumptionRows({
      lines: recipeLines(run.recipe),
      starchKg: run.starchKg,
      thresholdPct: run.recipe.deviationThresholdPct,
      entries,
    });
  } catch (e) {
    if (e instanceof RangeError)
      throw new UserError("Hay un insumo que no pertenece a la receta de esta producción.");
    throw e;
  }
  if (rows.length === 0) throw new UserError("Cargá al menos un consumo mayor a cero.");

  const lotIds = [...new Set(rows.map((r) => r.rawLotId).filter((x): x is string => !!x))];
  const lots = lotIds.length
    ? await db.select().from(schema.rawLots).where(inArray(schema.rawLots.id, lotIds))
    : [];
  for (const r of rows) {
    if (!r.rawLotId) continue;
    const lot = lots.find((l) => l.id === r.rawLotId);
    if (!lot || lot.ingredientId !== r.ingredientId)
      throw new UserError("El lote elegido no corresponde al insumo.");
  }

  // 1) Revertir lo cargado antes (movimientos compensatorios) y reemplazar las filas.
  if (run.consumptions.length) {
    const prior = await db
      .select({
        ingredientId: schema.stockMovements.ingredientId,
        rawLotId: schema.stockMovements.rawLotId,
        locationId: schema.stockMovements.locationId,
        qty: sql<number>`sum(${schema.stockMovements.qty})`.mapWith(Number),
      })
      .from(schema.stockMovements)
      .where(
        and(
          eq(schema.stockMovements.refTable, "production_runs"),
          eq(schema.stockMovements.refId, run.id),
          eq(schema.stockMovements.type, "production_consumption"),
        ),
      )
      .groupBy(
        schema.stockMovements.ingredientId,
        schema.stockMovements.rawLotId,
        schema.stockMovements.locationId,
      );
    await recordIngredientMovements(
      db,
      userId,
      prior
        .filter((p) => p.qty !== 0)
        .map((p) => ({
          type: "production_consumption" as const,
          ingredientId: p.ingredientId!,
          rawLotId: p.rawLotId,
          locationId: p.locationId,
          qty: -p.qty,
          refTable: "production_runs",
          refId: run.id,
          note: "Corrección de consumos",
        })),
    );
    await db.delete(schema.productionConsumptions).where(eq(schema.productionConsumptions.runId, run.id));
  }

  // 2) Insertar consumos y movimientos.
  await db.insert(schema.productionConsumptions).values(
    rows.map((r) => ({
      runId: run.id,
      ingredientId: r.ingredientId,
      rawLotId: r.rawLotId,
      qtyTheoretical: r.qtyTheoretical,
      qtyActual: r.qtyActual,
      outOfRange: r.outOfRange,
    })),
  );
  const ingredientRows = await db.query.ingredients.findMany({
    where: inArray(schema.ingredients.id, [...new Set(rows.map((r) => r.ingredientId))]),
  });
  const fallback = {
    cold: await locationByCode(db, "HELADERA"),
    dry: await locationByCode(db, "DEP-SECO"),
  };
  const moves: IngredientMovement[] = [];
  for (const r of rows) {
    const lot = lots.find((l) => l.id === r.rawLotId);
    let locationId = lot?.locationId ?? null;
    if (!locationId && r.rawLotId) {
      const [pos] = await db
        .select({ locationId: schema.ingredientStock.locationId })
        .from(schema.ingredientStock)
        .where(eq(schema.ingredientStock.rawLotId, r.rawLotId))
        .orderBy(desc(schema.ingredientStock.qty))
        .limit(1);
      locationId = pos?.locationId ?? null;
    }
    if (!locationId) {
      const refrigerated = ingredientRows.find((i) => i.id === r.ingredientId)?.refrigerated;
      locationId = (refrigerated ? fallback.cold : fallback.dry).id;
    }
    moves.push({
      type: "production_consumption",
      ingredientId: r.ingredientId,
      rawLotId: r.rawLotId,
      locationId,
      qty: -r.qtyActual,
      refTable: "production_runs",
      refId: run.id,
    });
  }
  await recordIngredientMovements(db, userId, moves);
  if (run.status === "planned") {
    await db
      .update(schema.productionRuns)
      .set({ status: "in_progress" })
      .where(eq(schema.productionRuns.id, run.id));
  }
  return { rows, outOfRange: rows.filter((r) => r.outOfRange).length };
}

/** Cambia el estado respetando las transiciones válidas (planned → in_progress → freezing → packed → closed). */
export async function setRunStatus(db: Executor, input: SetRunStatusInput & { freezerCodes?: string[] }) {
  const run = await requireRun(db, input.runId);
  const to = input.status as RunStatus;
  if (!canTransitionRun(run.status, to)) {
    throw new UserError(
      `No se puede pasar de "${RUN_STATUS[run.status]?.label}" a "${RUN_STATUS[to]?.label}".`,
    );
  }
  const patch: Partial<typeof schema.productionRuns.$inferInsert> = { status: to };
  if (to === "freezing") {
    const time = input.frozenTime;
    patch.freezerCodes = input.freezerCodes ?? [];
    patch.frozenAt = time ? new Date(`${run.date}T${time}:00-03:00`) : new Date();
  }
  if (to === "packed" && run.lots.every((l) => l.packings.length === 0)) {
    throw new UserError("Cargá el envasado antes de marcar la producción como envasada.");
  }
  const [row] = await db
    .update(schema.productionRuns)
    .set(patch)
    .where(eq(schema.productionRuns.id, run.id))
    .returning();
  return row!;
}

// ===========================================================================================
// RF-21 · Pesadas y rendimiento
// ===========================================================================================

export async function recordWeighings(db: Executor, userId: string | null, input: RecordWeighingsInput) {
  const run = await requireRun(db, input.runId);
  assertStatus(run, WEIGHING_STATUSES, "pesadas");
  const items = input.items
    .map((i) => ({ shape: i.shape, kg: typeof i.kg === "number" ? i.kg : Number(i.kg) }))
    .filter((i) => i.kg > 0);
  if (!items.length) throw new UserError("Cargá al menos una pesada mayor a cero.");
  const rows = await db
    .insert(schema.productionWeighings)
    .values(items.map((i) => ({ runId: run.id, shape: i.shape, kg: roundQty(i.kg), weighedById: userId })))
    .returning();
  return rows;
}

export async function deleteWeighing(db: Executor, id: string) {
  const w = await db.query.productionWeighings.findFirst({ where: eq(schema.productionWeighings.id, id) });
  if (!w) throw new UserError("La pesada no existe.");
  const run = await requireRun(db, w.runId);
  assertStatus(run, WEIGHING_STATUSES, "pesadas");
  await db.delete(schema.productionWeighings).where(eq(schema.productionWeighings.id, id));
}

/** Rendimiento, merma y bolsas equivalentes de una producción (Regla 3). */
export function runSummary(run: RunDetail) {
  return summarizeRun({
    starchKg: run.starchKg,
    expectedYieldPerKgStarch: run.recipe.expectedYieldPerKgStarch,
    theoreticalIngredientsKg: recipeIngredientsKg(recipeLines(run.recipe), run.starchKg),
    consumptions: run.consumptions,
    weighings: run.weighings,
  });
}

// ===========================================================================================
// RF-22 · Envasado, lote y etiqueta
// ===========================================================================================

/** Productos envasables y ubicaciones de producto terminado (F3/F4) para el formulario de envasado. */
export async function packingOptions(db: Executor) {
  const [products, locations] = await Promise.all([
    db.query.products.findMany({
      where: and(eq(schema.products.active, true), ne(schema.products.shape, "pizzeta")),
      orderBy: [asc(schema.products.presentation), asc(schema.products.name)],
    }),
    db.query.locations.findMany({
      where: and(eq(schema.locations.kind, "finished"), eq(schema.locations.active, true)),
      orderBy: asc(schema.locations.code),
    }),
  ]);
  return {
    products: products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      shape: p.shape,
      netWeightKg: p.netWeightKg,
      presentation: p.presentation,
    })),
    locations: locations.map((l) => ({ id: l.id, code: l.code, name: l.name })),
  };
}
export type PackingOptions = Awaited<ReturnType<typeof packingOptions>>;

/**
 * Envasa: crea el lote terminado si no existe (`AAMMDD-N`, vence a los 6 meses), registra bolsas por
 * producto y ubicación, suma stock (`production_output`) y descuenta los envases de `product_components`
 * de categoría packaging del depósito seco.
 */
export async function recordPacking(db: Executor, userId: string | null, input: RecordPackingInput) {
  const run = await requireRun(db, input.runId);
  assertStatus(run, PACKING_STATUSES, "envasado");
  const items = input.items.map((i) => ({
    productId: i.productId,
    locationId: i.locationId,
    units: typeof i.units === "number" ? i.units : Number(i.units),
  }));

  const products = await db.query.products.findMany({
    where: inArray(schema.products.id, [...new Set(items.map((i) => i.productId))]),
    with: { components: { with: { ingredient: true } } },
  });
  const locations = await db.query.locations.findMany({
    where: inArray(schema.locations.id, [...new Set(items.map((i) => i.locationId))]),
  });
  for (const it of items) {
    if (!products.some((p) => p.id === it.productId)) throw new UserError("El producto no existe.");
    const loc = locations.find((l) => l.id === it.locationId);
    if (!loc) throw new UserError("La ubicación no existe.");
    if (loc.kind !== "finished") throw new UserError("El producto terminado se guarda en F3 o F4.");
  }

  let lot = run.lots[0];
  if (!lot) {
    const [created] = await db
      .insert(schema.finishedLots)
      .values({
        code: finishedLotCode(run.date, run.runNumber),
        runId: run.id,
        productionDate: run.date,
        expiryDate: finishedLotExpiry(run.date),
      })
      .returning();
    lot = { ...created!, packings: [] };
  }
  if (lot.onHold) throw new UserError("El lote está retenido por calidad: no se puede seguir envasando.");

  const dryStore = await locationByCode(db, "DEP-SECO");
  const packings = [];
  for (const it of items) {
    const product = products.find((p) => p.id === it.productId)!;
    const [packing] = await db
      .insert(schema.packings)
      .values({
        finishedLotId: lot.id,
        productId: product.id,
        units: it.units,
        kg: roundQty(it.units * product.netWeightKg),
        locationId: it.locationId,
        packedById: userId,
      })
      .returning();
    packings.push(packing!);
    const output: ProductMovement = {
      type: "production_output",
      productId: product.id,
      finishedLotId: lot.id,
      locationId: it.locationId,
      qty: it.units,
      refTable: "packings",
      refId: packing!.id,
    };
    await recordProductMovements(db, userId, [output]);
    await recordIngredientMovements(
      db,
      userId,
      product.components
        .filter((c) => c.ingredient.category === "packaging")
        .map((c) => ({
          type: "production_consumption" as const,
          ingredientId: c.ingredientId,
          rawLotId: null,
          locationId: dryStore.id,
          qty: -roundQty(c.qtyPerUnit * it.units),
          refTable: "packings",
          refId: packing!.id,
          note: `Envase de ${product.name}`,
        })),
    );
  }
  return { lot, packings };
}

/** Lote por código con su producción, envasados y stock actual por producto y ubicación. */
export async function getLotByCode(db: Executor, code: string) {
  const lot = await db.query.finishedLots.findFirst({
    where: eq(schema.finishedLots.code, code),
    with: {
      run: true,
      packings: { with: { product: true, location: true }, orderBy: asc(schema.packings.packedAt) },
    },
  });
  if (!lot) return null;
  const stock = await db
    .select({
      productId: schema.productStock.productId,
      locationId: schema.productStock.locationId,
      qty: schema.productStock.qty,
      productName: schema.products.name,
      locationCode: schema.locations.code,
    })
    .from(schema.productStock)
    .innerJoin(schema.products, eq(schema.products.id, schema.productStock.productId))
    .innerJoin(schema.locations, eq(schema.locations.id, schema.productStock.locationId))
    .where(eq(schema.productStock.finishedLotId, lot.id))
    .orderBy(asc(schema.products.name), asc(schema.locations.code));
  return { ...lot, stock };
}
export type LotDetail = NonNullable<Awaited<ReturnType<typeof getLotByCode>>>;

/** Lotes terminados recientes con su stock actual en unidades. */
export async function listRecentLots(db: Executor, limit = 8) {
  const lots = await db.query.finishedLots.findMany({
    orderBy: [desc(schema.finishedLots.productionDate), desc(schema.finishedLots.code)],
    limit,
  });
  if (!lots.length) return [];
  const stock = await db
    .select({
      finishedLotId: schema.productStock.finishedLotId,
      units: sql<number>`sum(${schema.productStock.qty})`.mapWith(Number),
    })
    .from(schema.productStock)
    .where(
      inArray(
        schema.productStock.finishedLotId,
        lots.map((l) => l.id),
      ),
    )
    .groupBy(schema.productStock.finishedLotId);
  return lots.map((l) => ({ ...l, stockUnits: stock.find((s) => s.finishedLotId === l.id)?.units ?? 0 }));
}
