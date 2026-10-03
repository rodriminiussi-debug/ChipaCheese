import { addDays, addMonths, diffDays, isoWeekday, isWorkday, type IsoDate } from "./dates";
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

export type CleaningFrequency = "daily" | "weekly" | "monthly";

/** Primer día (YYYY-MM-01) y último día del mes de una fecha o clave "YYYY-MM". */
export function monthBounds(monthOrDate: string): { from: IsoDate; to: IsoDate } {
  const from = `${monthOrDate.slice(0, 7)}-01`;
  return { from, to: addDays(addMonths(from, 1), -1) };
}

/** Lunes de la semana ISO de una fecha. */
export function startOfIsoWeek(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoWeekday(date));
}

/**
 * RF-34: ¿corresponde limpiar este punto hoy? Diaria: si no se registró hoy. Semanal: si no se registró
 * en la semana (lunes a domingo). Mensual: si no se registró en el mes. `doneDates` = fechas con registro.
 */
export function isCleaningDue(frequency: CleaningFrequency, today: IsoDate, doneDates: IsoDate[]): boolean {
  switch (frequency) {
    case "daily":
      return !doneDates.includes(today);
    case "weekly": {
      const from = startOfIsoWeek(today);
      return !doneDates.some((d) => d >= from && d <= today);
    }
    case "monthly":
      return !doneDates.some((d) => d.slice(0, 7) === today.slice(0, 7));
  }
}

/**
 * RF-34 / "Registros BPM al día": fechas en las que se esperaba un registro de limpieza dentro de
 * `[from, to]` (solo días anteriores a `today`: el día en curso todavía puede completarse).
 *  - diaria: cada día hábil;
 *  - semanal: el viernes de cada semana (cubierta si hubo registro en esa semana);
 *  - mensual: el último día hábil del mes (cubierta si hubo registro en el mes).
 */
export function cleaningExpectations(
  frequency: CleaningFrequency,
  doneDates: IsoDate[],
  from: IsoDate,
  to: IsoDate,
  today: IsoDate,
): { date: IsoDate; done: boolean }[] {
  const out: { date: IsoDate; done: boolean }[] = [];
  const last = to < today ? to : addDays(today, -1);
  if (frequency === "daily") {
    for (let d = from; d <= last; d = addDays(d, 1)) {
      if (isWorkday(d)) out.push({ date: d, done: doneDates.includes(d) });
    }
  } else if (frequency === "weekly") {
    for (let d = from; d <= last; d = addDays(d, 1)) {
      if (isoWeekday(d) !== 5) continue;
      const weekFrom = addDays(d, -4);
      const weekTo = addDays(d, 2);
      out.push({ date: d, done: doneDates.some((x) => x >= weekFrom && x <= weekTo) });
    }
  } else {
    const { from: mFrom, to: mTo } = monthBounds(from);
    let d = mTo;
    while (!isWorkday(d)) d = addDays(d, -1);
    if (d >= from && d <= to && d <= last && d >= mFrom) {
      out.push({ date: d, done: doneDates.some((x) => x.slice(0, 7) === d.slice(0, 7)) });
    }
  }
  return out;
}
