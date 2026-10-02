import { roundQty, roundTo } from "./units";

/** Línea de receta maestra, por kg de fécula (RF-18). Rangos opcionales (p. ej. leche). */
export interface RecipeLine {
  ingredientId: string;
  qtyPerKgStarch: number;
  minPerKgStarch?: number | null;
  maxPerKgStarch?: number | null;
}

export interface TheoreticalConsumption {
  ingredientId: string;
  qty: number;
  min: number | null;
  max: number | null;
}

/**
 * Regla 2: consumo teórico de un insumo = receta por kg de fécula × kg de fécula usados.
 * Devuelve también el rango aceptable (min/max) en cantidad absoluta, o null si no hay rango.
 * Ej.: 0,3 kg/kg fécula × 75 kg = 22,5 kg de queso barra.
 */
export function theoreticalConsumption(lines: RecipeLine[], starchKg: number): TheoreticalConsumption[] {
  return lines.map((l) => ({
    ingredientId: l.ingredientId,
    qty: roundQty(l.qtyPerKgStarch * starchKg),
    min: l.minPerKgStarch == null ? null : roundQty(l.minPerKgStarch * starchKg),
    max: l.maxPerKgStarch == null ? null : roundQty(l.maxPerKgStarch * starchKg),
  }));
}

/**
 * Regla 2: desvío del consumo real contra el teórico.
 * `diff` = real − teórico; `pct` = diff ÷ teórico × 100 (2 decimales).
 * Teórico 0: pct 0 si el real también es 0, `Infinity` en otro caso.
 */
export function consumptionDeviation(theoretical: number, actual: number): { diff: number; pct: number } {
  const diff = roundQty(actual - theoretical);
  if (theoretical === 0) return { diff, pct: actual === 0 ? 0 : Infinity };
  return { diff, pct: roundTo((diff / theoretical) * 100, 2) };
}

export type ConsumptionReason =
  "in_range" | "below_range" | "above_range" | "over_threshold" | "within_threshold";

/**
 * Regla 2: ¿el consumo real es aceptable? Si la receta define rango min/max
 * (cantidades absolutas) manda el rango; si no, se compara |desvío %| contra
 * `thresholdPct` (el umbral está "a definir" en el relevamiento).
 */
export function checkConsumption(input: {
  theoretical: number;
  actual: number;
  min?: number | null;
  max?: number | null;
  thresholdPct: number;
}): { ok: boolean; reason: ConsumptionReason; pct: number } {
  const { theoretical, actual, min, max, thresholdPct } = input;
  const { pct } = consumptionDeviation(theoretical, actual);
  const hasRange = min != null || max != null;
  if (hasRange) {
    if (min != null && actual < min) return { ok: false, reason: "below_range", pct };
    if (max != null && actual > max) return { ok: false, reason: "above_range", pct };
    return { ok: true, reason: "in_range", pct };
  }
  if (Math.abs(pct) > thresholdPct) return { ok: false, reason: "over_threshold", pct };
  return { ok: true, reason: "within_threshold", pct };
}

/**
 * Suma total de ingredientes para `starchKg` de fécula (se asume 1 litro de leche ≈ 1 kg).
 * Es el denominador del rendimiento (Regla 3).
 */
export function recipeIngredientsKg(lines: RecipeLine[], starchKg: number): number {
  return roundQty(theoreticalConsumption(lines, starchKg).reduce((acc, c) => acc + c.qty, 0));
}
