import { addDays, diffDays, type IsoDate } from "./dates";
import { roundTo } from "./units";

/**
 * RF-34: carga tardía si la fecha a la que corresponde el registro es anterior
 * al día en que se cargó (completar un día pasado).
 */
export function isLateEntry(recordedFor: IsoDate, createdAtDate: IsoDate): boolean {
  return recordedFor < createdAtDate;
}

/** RF-38: estado de una temperatura contra su rango (límites null = sin límite). */
export function temperatureStatus(
  valueC: number,
  range: { min: number | null; max: number | null },
): "ok" | "low" | "high" {
  if (range.min !== null && valueC < range.min) return "low";
  if (range.max !== null && valueC > range.max) return "high";
  return "ok";
}

/**
 * RF-37: próximo vencimiento de un preventivo = última ejecución + frecuencia.
 * Si nunca se hizo, se cuenta desde la fecha de alta del plan (`startDate` + frecuencia),
 * de modo que un plan recién creado no nace vencido.
 */
export function nextMaintenanceDue(
  lastDone: IsoDate | null,
  frequencyDays: number,
  startDate: IsoDate,
): IsoDate {
  if (!(frequencyDays > 0)) throw new RangeError("frequencyDays must be > 0");
  return addDays(lastDone ?? startDate, frequencyDays);
}

/**
 * RF-37: estado de un preventivo. `overdue` si ya pasó el vencimiento; `due_soon` si
 * vence hoy o en los próximos `warnDays` días (default 7); `ok` en otro caso.
 */
export function maintenanceStatus(
  nextDue: IsoDate,
  today: IsoDate,
  warnDays = 7,
): "ok" | "due_soon" | "overdue" {
  const left = diffDays(nextDue, today);
  if (left < 0) return "overdue";
  if (left <= warnDays) return "due_soon";
  return "ok";
}

/**
 * Indicadores "Registros BPM al día" y "Preventivos cumplidos": hechos ÷ esperados en %
 * (0..100, 1 decimal). null si no había nada esperado.
 */
export function complianceRate(done: number, expected: number): number | null {
  if (!(expected > 0)) return null;
  return roundTo(Math.min(100, Math.max(0, (done / expected) * 100)), 1);
}
