/**
 * Fechas de negocio como strings ISO `YYYY-MM-DD`, sin zona horaria.
 * Internamente se opera en UTC para evitar corrimientos por horario de verano.
 */
export type IsoDate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** Cantidad de días de un mes (month 1..12). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Parsea y valida `YYYY-MM-DD` (rechaza 2026-02-30). Devuelve ms UTC a medianoche. */
function parseMs(date: IsoDate): number {
  const m = ISO_RE.exec(date);
  if (!m) throw new RangeError(`Invalid ISO date: "${date}"`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) {
    throw new RangeError(`Invalid ISO date: "${date}"`);
  }
  return Date.UTC(y, mo - 1, d);
}

/** Lanza `RangeError` si `date` no es una fecha ISO `YYYY-MM-DD` válida. */
export function assertIsoDate(date: IsoDate): void {
  parseMs(date);
}

function fromMs(ms: number): IsoDate {
  const dt = new Date(ms);
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1, 2)}-${pad(dt.getUTCDate(), 2)}`;
}

/** Suma `days` días (puede ser negativo) a una fecha ISO. */
export function addDays(date: IsoDate, days: number): IsoDate {
  return fromMs(parseMs(date) + Math.round(days) * MS_PER_DAY);
}

/**
 * Suma `months` meses con fin de mes seguro: si el día no existe en el mes
 * destino se usa el último día (31/08 + 6 meses = 28/02 o 29/02).
 * Regla 4: vencimiento = elaboración + 6 meses.
 */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const ms = parseMs(date);
  const dt = new Date(ms);
  const total = dt.getUTCFullYear() * 12 + dt.getUTCMonth() + Math.round(months);
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1; // 1..12
  const day = Math.min(dt.getUTCDate(), daysInMonth(year, month));
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * Diferencia en días `a − b` (positiva si `a` es posterior a `b`).
 * Ej.: diffDays("2026-09-10", "2026-09-01") = 9.
 */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((parseMs(a) - parseMs(b)) / MS_PER_DAY);
}

/** Día de la semana ISO: 1 = lunes … 7 = domingo. */
export function isoWeekday(date: IsoDate): number {
  const d = new Date(parseMs(date)).getUTCDay(); // 0 = domingo
  return d === 0 ? 7 : d;
}

/** ¿Es día hábil de producción? Por defecto lunes a viernes. */
export function isWorkday(date: IsoDate, workdays: number[] = [1, 2, 3, 4, 5]): boolean {
  return workdays.includes(isoWeekday(date));
}

/**
 * Los próximos `count` días hábiles, empezando en `from` (inclusive si es hábil).
 * Lanza error si `workdays` está vacío (evita bucle infinito).
 */
export function nextWorkdays(from: IsoDate, count: number, workdays: number[] = [1, 2, 3, 4, 5]): IsoDate[] {
  if (count <= 0) return [];
  if (workdays.length === 0) throw new RangeError("workdays must not be empty");
  const result: IsoDate[] = [];
  let cursor = from;
  while (result.length < count) {
    if (isWorkday(cursor, workdays)) result.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return result;
}

/** Clave de mes "YYYY-MM" para agrupar resultados mensuales (RF-40). */
export function monthKey(date: IsoDate): string {
  assertIsoDate(date);
  return date.slice(0, 7);
}
