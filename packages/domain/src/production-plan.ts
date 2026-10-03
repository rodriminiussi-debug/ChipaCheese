import { addDays, isoWeekday, type IsoDate } from "./dates";
import type { ShapeDemand } from "./planning";
import { bagsEquivalent, roundQty } from "./units";
import { lossKg, productionYield } from "./production";
import { checkConsumption, theoreticalConsumption, type ConsumptionReason, type RecipeLine } from "./recipe";

/**
 * Cálculos puros de producción que no son "regla de negocio del dominio" pero sí tienen lógica propia
 * (conversión de demanda a kg por forma, estados, filas de consumo). Sin I/O: se testean en calc.test.ts.
 */

/** Formas de la masa: lo que se amasa y se pesa. Sándwich y pizzeta quedan fuera del plan de masa. */
export const PLAN_SHAPES = ["tapita", "arito", "lenguita"] as const;
export type PlanShape = (typeof PLAN_SHAPES)[number];
export const isPlanShape = (s: string): s is PlanShape => (PLAN_SHAPES as readonly string[]).includes(s);

/**
 * Reparte `kg` de un producto entre las formas de masa. `mixed` (surtido) va en partes iguales
 * a tapita/arito/lenguita; sándwich y pizzeta no entran al plan de masa.
 */
export function splitKgByPlanShape(shape: string, kg: number): Partial<Record<PlanShape, number>> {
  if (shape === "mixed") {
    const part = kg / PLAN_SHAPES.length;
    return { tapita: part, arito: part, lenguita: part };
  }
  if (isPlanShape(shape)) return { [shape]: kg };
  return {};
}

/** Suma filas {shape, kg} por forma de masa (aplicando el reparto del surtido). */
export function sumKgByPlanShape(rows: { shape: string; kg: number }[]): Record<PlanShape, number> {
  const out: Record<PlanShape, number> = { tapita: 0, arito: 0, lenguita: 0 };
  for (const r of rows) {
    for (const [shape, kg] of Object.entries(splitKgByPlanShape(r.shape, r.kg))) {
      out[shape as PlanShape] += kg;
    }
  }
  for (const s of PLAN_SHAPES) out[s] = roundQty(out[s]);
  return out;
}

/**
 * RF-19: arma la entrada de `suggestDailyPlan`.
 * - pendientes: unidades pedidas × peso neto, por forma;
 * - stock: unidades terminadas × peso neto;
 * - mínimo: stock mínimo por producto × peso neto.
 */
export function buildShapeDemands(input: {
  pending: { shape: string; units: number; netWeightKg: number }[];
  stock: { shape: string; units: number; netWeightKg: number }[];
  minStock: { shape: string; units: number; netWeightKg: number }[];
}): ShapeDemand[] {
  const toKg = (rows: { shape: string; units: number; netWeightKg: number }[]) =>
    sumKgByPlanShape(rows.map((r) => ({ shape: r.shape, kg: r.units * r.netWeightKg })));
  const pending = toKg(input.pending);
  const stock = toKg(input.stock);
  const min = toKg(input.minStock);
  return PLAN_SHAPES.map((shape) => ({
    shape,
    pendingKg: pending[shape],
    stockKg: stock[shape],
    minStockKg: min[shape],
  }));
}

/** Uso de la capacidad diaria (0–100+ %) y su tono para la barra semanal. */
export function capacityUsage(plannedKg: number, capacityKg: number) {
  const pct = capacityKg > 0 ? Math.round((plannedKg / capacityKg) * 100) : 0;
  const tone: "good" | "warn" | "bad" | "neutral" =
    plannedKg <= 0 ? "neutral" : plannedKg > capacityKg ? "bad" : pct >= 90 ? "warn" : "good";
  return { pct, tone };
}

/** Días de producción de la semana ISO que contiene `date` (por defecto lunes a viernes). */
export function weekDays(date: IsoDate, workdays: number[] = [1, 2, 3, 4, 5]): IsoDate[] {
  const monday = addDays(date, 1 - isoWeekday(date));
  return [1, 2, 3, 4, 5, 6, 7]
    .map((n) => addDays(monday, n - 1))
    .filter((d) => workdays.includes(isoWeekday(d)));
}

// --- Estados de la producción (RF-20) -------------------------------------------------------

export type RunStatus = "planned" | "in_progress" | "freezing" | "packed" | "closed" | "cancelled";

const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  planned: ["in_progress", "cancelled"],
  in_progress: ["freezing", "cancelled"],
  freezing: ["packed", "cancelled"],
  packed: ["closed"],
  closed: [],
  cancelled: [],
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}
export const nextRunStatuses = (from: RunStatus) => RUN_TRANSITIONS[from];

/** Estados en los que todavía se puede cargar cada tipo de dato. */
export const CONSUMPTION_STATUSES: RunStatus[] = ["planned", "in_progress", "freezing"];
export const WEIGHING_STATUSES: RunStatus[] = ["in_progress", "freezing", "packed"];
export const PACKING_STATUSES: RunStatus[] = ["in_progress", "freezing", "packed"];

// --- Consumos (Regla 2) ----------------------------------------------------------------------

export interface ConsumptionEntry {
  ingredientId: string;
  rawLotId: string | null;
  qty: number;
}
export interface ConsumptionRow {
  ingredientId: string;
  rawLotId: string | null;
  qtyTheoretical: number;
  qtyActual: number;
  outOfRange: boolean;
  reason: ConsumptionReason;
  pct: number;
}

/**
 * Convierte lo cargado (real por insumo y lote) en filas de `production_consumptions`.
 * El desvío se evalúa sobre el TOTAL real del insumo (suma de sus lotes) contra el teórico de la
 * receta (`checkConsumption`: rango min/max si existe; si no, umbral %). El teórico se reparte entre
 * las filas del mismo insumo en proporción a lo consumido, de modo que la suma por insumo es el teórico.
 * Las entradas con cantidad 0 se ignoran.
 */
export function buildConsumptionRows(input: {
  lines: RecipeLine[];
  starchKg: number;
  thresholdPct: number;
  entries: ConsumptionEntry[];
}): ConsumptionRow[] {
  const theo = new Map(theoreticalConsumption(input.lines, input.starchKg).map((t) => [t.ingredientId, t]));
  const byIngredient = new Map<string, ConsumptionEntry[]>();
  for (const e of input.entries) {
    if (!(e.qty > 0)) continue;
    const list = byIngredient.get(e.ingredientId) ?? [];
    list.push(e);
    byIngredient.set(e.ingredientId, list);
  }
  const rows: ConsumptionRow[] = [];
  for (const [ingredientId, entries] of byIngredient) {
    const t = theo.get(ingredientId);
    if (!t) throw new RangeError(`el insumo ${ingredientId} no está en la receta`);
    const total = roundQty(entries.reduce((a, e) => a + e.qty, 0));
    const check = checkConsumption({
      theoretical: t.qty,
      actual: total,
      min: t.min,
      max: t.max,
      thresholdPct: input.thresholdPct,
    });
    let assigned = 0;
    entries.forEach((e, i) => {
      const last = i === entries.length - 1;
      const share = last ? roundQty(t.qty - assigned) : roundQty((t.qty * e.qty) / total);
      assigned = roundQty(assigned + share);
      rows.push({
        ingredientId,
        rawLotId: e.rawLotId,
        qtyTheoretical: share,
        qtyActual: roundQty(e.qty),
        outOfRange: !check.ok,
        reason: check.reason,
        pct: check.pct,
      });
    });
  }
  return rows;
}

// --- Rendimiento (Regla 3, RF-21) --------------------------------------------------------------

export interface RunSummary {
  weighedKg: number;
  byShape: Record<PlanShape, number>;
  /** kg de ingredientes: reales si ya se cargaron consumos; si no, los teóricos de la receta. */
  ingredientsKg: number;
  ingredientsSource: "actual" | "theoretical";
  yieldRatio: number;
  lossKg: number;
  bags: number;
  /** kg de producto por kg de fécula, real vs esperado de la receta. */
  kgPerKgStarch: number | null;
  expectedKgPerKgStarch: number;
  expectedWeighedKg: number;
  /** Diferencia de kg pesados contra lo esperado de la receta (negativa = menos de lo esperado). */
  deltaKg: number;
}

export function summarizeRun(input: {
  starchKg: number;
  expectedYieldPerKgStarch: number;
  theoreticalIngredientsKg: number;
  consumptions: { qtyActual: number }[];
  weighings: { shape: string; kg: number }[];
}): RunSummary {
  const byShape = sumKgByPlanShape(input.weighings);
  const weighedKg = roundQty(input.weighings.reduce((a, w) => a + w.kg, 0));
  const actualKg = roundQty(input.consumptions.reduce((a, c) => a + c.qtyActual, 0));
  const hasActual = input.consumptions.length > 0;
  const ingredientsKg = hasActual ? actualKg : input.theoreticalIngredientsKg;
  const expectedWeighedKg = roundQty(input.expectedYieldPerKgStarch * input.starchKg);
  return {
    weighedKg,
    byShape,
    ingredientsKg,
    ingredientsSource: hasActual ? "actual" : "theoretical",
    yieldRatio: productionYield(weighedKg, ingredientsKg),
    lossKg: lossKg(weighedKg, ingredientsKg),
    bags: bagsEquivalent(weighedKg),
    kgPerKgStarch: input.starchKg > 0 && weighedKg > 0 ? roundQty(weighedKg / input.starchKg) : null,
    expectedKgPerKgStarch: input.expectedYieldPerKgStarch,
    expectedWeighedKg,
    deltaKg: roundQty(weighedKg - expectedWeighedKg),
  };
}
