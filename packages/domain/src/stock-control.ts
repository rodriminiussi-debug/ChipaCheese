import { STARCH_KG_PER_RECIPE } from "./constants";
import { diffDays, type IsoDate } from "./dates";
import type { RecipeLine } from "./recipe";
import { canProduce } from "./stock";
import { roundMoney, roundQty } from "./units";

/**
 * Control de stock (M3): estado de cobertura, alertas de vencimiento, diferencias de inventario
 * y simulador de producción. Complementa `stock.ts` (FEFO, cobertura, punto de pedido).
 */

/** RF-14: estado de un insumo frente a su punto de pedido. */
export type CoverageStatus = "ok" | "reorder" | "out_of_stock" | "no_consumption";

/**
 * Clasifica un insumo (RF-14). Prioridad:
 * 1. sin stock (saldo <= 0);
 * 2. reponer: el saldo llegó o bajó del punto de pedido (Regla 7) o quedó por debajo del stock mínimo;
 * 3. sin consumo: no hubo consumos en la ventana, no hay cobertura calculable;
 * 4. ok.
 */
export function classifyCoverage(input: {
  stock: number;
  minStock: number;
  avgDailyConsumption: number;
  reorderPoint: number;
}): CoverageStatus {
  const { stock, minStock, avgDailyConsumption, reorderPoint } = input;
  if (stock <= 0) return "out_of_stock";
  if (stock <= reorderPoint || stock < minStock) return "reorder";
  if (avgDailyConsumption <= 0) return "no_consumption";
  return "ok";
}

const STATUS_RANK: Record<CoverageStatus, number> = {
  out_of_stock: 0,
  reorder: 1,
  ok: 2,
  no_consumption: 3,
};

/**
 * Orden por urgencia: sin stock → reponer → ok → sin consumo; dentro de cada grupo,
 * menos días de cobertura primero (cobertura infinita/nula al final).
 */
export function compareCoverageUrgency(
  a: { status: CoverageStatus; coverageDays: number | null },
  b: { status: CoverageStatus; coverageDays: number | null },
): number {
  if (a.status !== b.status) return STATUS_RANK[a.status] - STATUS_RANK[b.status];
  const ca = a.coverageDays ?? Infinity;
  const cb = b.coverageDays ?? Infinity;
  if (ca === cb) return 0;
  return ca < cb ? -1 : 1;
}

/** Días antes del vencimiento a partir de los cuales se alerta (RF-13). */
export const EXPIRY_ALERT_DAYS = 7;

export type ExpiryLevel = "none" | "ok" | "soon" | "expired";

/**
 * RF-13: días a vencer y nivel de alerta de un lote. `soon` cuando faltan `thresholdDays` o menos;
 * `expired` cuando ya venció; `none` si el lote no tiene vencimiento (p. ej. envases).
 */
export function expiryAlert(
  expiryDate: IsoDate | null,
  today: IsoDate,
  thresholdDays: number = EXPIRY_ALERT_DAYS,
): { daysLeft: number | null; level: ExpiryLevel } {
  if (!expiryDate) return { daysLeft: null, level: "none" };
  const daysLeft = diffDays(expiryDate, today);
  if (daysLeft < 0) return { daysLeft, level: "expired" };
  return { daysLeft, level: daysLeft <= thresholdDays ? "soon" : "ok" };
}

/** RF-15: diferencia de inventario = contado − sistema (positiva = sobrante). */
export function countDifference(systemQty: number, countedQty: number): number {
  return roundQty(countedQty - systemQty);
}

/** RF-15: valorizado de una diferencia con el último precio sin IVA; `null` si no hay precio. */
export function valueDifference(diff: number, unitPriceNet: number | null | undefined): number | null {
  if (unitPriceNet == null) return null;
  return roundMoney(diff * unitPriceNet);
}

/**
 * RF-17: máximo de kg de fécula que se pueden procesar con el stock disponible (el insumo más
 * escaso manda). 0 si falta algún insumo o la receta no tiene líneas.
 */
export function maxStarchKg(lines: RecipeLine[], stockByIngredient: Record<string, number>): number {
  let max = Infinity;
  for (const l of lines) {
    if (!(l.qtyPerKgStarch > 0)) continue;
    const available = Math.max(0, stockByIngredient[l.ingredientId] ?? 0);
    max = Math.min(max, available / l.qtyPerKgStarch);
  }
  return Number.isFinite(max) ? roundQty(max) : 0;
}

export interface SimulationLine {
  ingredientId: string;
  needed: number;
  available: number;
  shortfall: number;
  ok: boolean;
}

export interface ProductionSimulation {
  starchKg: number;
  ok: boolean;
  lines: SimulationLine[];
  /** kg de fécula máximos con el stock actual. */
  maxStarchKg: number;
  /** kg de producto estimados con ese máximo (rendimiento esperado de la receta). */
  maxProductKg: number;
  /** Recetas completas (75 kg de fécula cada una) que alcanzan. */
  completeRecipes: number;
}

/**
 * RF-17: "¿alcanza la materia prima para producir X?". Devuelve la tabla necesidad vs disponible
 * de TODAS las líneas de la receta, el faltante y cuántas recetas completas alcanzan.
 */
export function simulateProduction(input: {
  starchKg: number;
  lines: RecipeLine[];
  stockByIngredient: Record<string, number>;
  expectedYieldPerKgStarch: number;
  starchKgPerRecipe?: number;
}): ProductionSimulation {
  const perRecipe = input.starchKgPerRecipe ?? STARCH_KG_PER_RECIPE;
  const check = canProduce(input);
  const lines: SimulationLine[] = input.lines.map((l) => {
    const needed = roundQty(l.qtyPerKgStarch * input.starchKg);
    const available = roundQty(input.stockByIngredient[l.ingredientId] ?? 0);
    const miss = check.missing.find((m) => m.ingredientId === l.ingredientId);
    return {
      ingredientId: l.ingredientId,
      needed,
      available,
      shortfall: miss?.shortfall ?? 0,
      ok: !miss,
    };
  });
  const maxStarch = maxStarchKg(input.lines, input.stockByIngredient);
  return {
    starchKg: input.starchKg,
    ok: check.ok,
    lines,
    maxStarchKg: maxStarch,
    maxProductKg: roundQty(maxStarch * input.expectedYieldPerKgStarch),
    completeRecipes: Math.floor(maxStarch / perRecipe),
  };
}
