import { addDays, isoWeekday, type IsoDate } from "@chipa/domain";

/** Feriados y puentes del período (Argentina 2026). */
export const HOLIDAYS = new Set<IsoDate>(["2026-07-09", "2026-07-10", "2026-08-17"]);

export const isWorkday = (d: IsoDate): boolean => isoWeekday(d) <= 5 && !HOLIDAYS.has(d);

export function nextWorkday(d: IsoDate): IsoDate {
  let x = addDays(d, 1);
  while (!isWorkday(x)) x = addDays(x, 1);
  return x;
}

export function prevWorkday(d: IsoDate): IsoDate {
  let x = addDays(d, -1);
  while (!isWorkday(x)) x = addDays(x, -1);
  return x;
}

/** Lunes de la semana de `d`. */
export const mondayOf = (d: IsoDate): IsoDate => addDays(d, 1 - isoWeekday(d));

/**
 * Si el día nominal de reparto cae en feriado: se adelanta al día hábil anterior de la misma semana o,
 * si no hay, se pasa al siguiente hábil.
 */
export function shiftHoliday(d: IsoDate): IsoDate {
  if (isWorkday(d)) return d;
  const monday = mondayOf(d);
  let x = addDays(d, -1);
  while (x >= monday) {
    if (isWorkday(x)) return x;
    x = addDays(x, -1);
  }
  return nextWorkday(d);
}

/** Todas las fechas de [from, to]. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Instante en hora argentina (UTC-3, sin horario de verano). */
export const at = (date: IsoDate, time: string): Date => new Date(`${date}T${time}:00-03:00`);

/** Suma minutos a un instante. */
export const plusMin = (d: Date, minutes: number): Date => new Date(d.getTime() + minutes * 60_000);

/** "HH:MM" a partir de minutos desde la medianoche. */
export function clock(minutes: number): string {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Fecha (AR) de un instante. */
export function dateOf(d: Date): IsoDate {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}
