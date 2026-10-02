import { DAILY_CAPACITY_KG, MIN_BATCH_KG, SHELF_LIFE_MONTHS } from "./constants";
import { addMonths, assertIsoDate, type IsoDate } from "./dates";
import { roundQty, roundTo } from "./units";

/**
 * Regla 3: rendimiento = kg pesados ÷ kg de ingredientes (ratio, 4 decimales).
 * Ej.: 149,3 ÷ 163,5 = 0,9131. Si no hay ingredientes devuelve 0.
 */
export function productionYield(weighedKg: number, ingredientsKg: number): number {
  if (ingredientsKg <= 0) return 0;
  return roundTo(weighedKg / ingredientsKg, 4);
}

/** Merma en kg = ingredientes − pesado (RF-21). Puede ser negativa si se pesó de más. */
export function lossKg(weighedKg: number, ingredientsKg: number): number {
  return roundQty(ingredientsKg - weighedKg);
}

/**
 * Regla 4: identificador único de lote de producto terminado "AAMMDD-N"
 * (fecha de elaboración + número de producción del día). Ej.: ("2026-09-01", 1) → "260901-1".
 */
export function finishedLotCode(productionDate: IsoDate, runNumber: number): string {
  if (!Number.isInteger(runNumber) || runNumber < 1) {
    throw new RangeError("runNumber must be a positive integer");
  }
  assertIsoDate(productionDate);
  return `${productionDate.slice(2, 4)}${productionDate.slice(5, 7)}${productionDate.slice(8, 10)}-${runNumber}`;
}

/** Regla 4: vencimiento = elaboración + 6 meses (fin de mes seguro). */
export function finishedLotExpiry(productionDate: IsoDate, months: number = SHELF_LIFE_MONTHS): IsoDate {
  return addMonths(productionDate, months);
}

/**
 * Regla 1: valida los kg planificados para un día. 0 kg es válido (no se produce);
 * entre 0 y el mínimo por tanda → `below_min_batch`; sobre el abatidor → `over_capacity`.
 */
export function validateDailyLoad(
  plannedKgForDay: number,
  capacityKg: number = DAILY_CAPACITY_KG,
  minBatchKg: number = MIN_BATCH_KG,
): { ok: boolean; reason?: "below_min_batch" | "over_capacity" } {
  if (!(plannedKgForDay >= 0)) throw new RangeError("plannedKgForDay must be >= 0");
  if (plannedKgForDay > capacityKg) return { ok: false, reason: "over_capacity" };
  if (plannedKgForDay > 0 && plannedKgForDay < minBatchKg) {
    return { ok: false, reason: "below_min_batch" };
  }
  return { ok: true };
}
