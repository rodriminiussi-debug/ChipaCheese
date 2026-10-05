import { addDays, addMonths, diffDays, isoWeekday, type IsoDate } from "./dates";
import { priceVariationPct } from "./invoices";
import { roundTo } from "./units";

/**
 * Reglas puras del tablero visual (RF-41): series temporales, precios a una fecha, lotes por vencer.
 * Sin I/O: la app arma las consultas y delega las cuentas acá.
 */

/** Lunes de la semana ISO de `date`. */
export function weekStart(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoWeekday(date));
}

/**
 * Lunes de las últimas `count` semanas terminando en la semana de `today` (inclusive), del más viejo al más nuevo.
 * Ej.: ("2026-10-02", 3) → ["2026-09-14", "2026-09-21", "2026-09-28"].
 */
export function lastWeekStarts(today: IsoDate, count: number): IsoDate[] {
  const current = weekStart(today);
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(current, -7 * (count - 1 - i)));
}

/** Día final de las series de un mes: el último día del mes, o `today` si el mes todavía no terminó. */
export function monthSeriesEnd(month: string, today: IsoDate): IsoDate {
  const last = addDays(addMonths(`${month}-01`, 1), -1);
  return last > today ? today : last;
}

export interface DatedPrice {
  ingredientId: string;
  date: IsoDate;
  unitPriceNet: number;
}

/**
 * Precio de compra vigente (sin IVA) de cada insumo a una fecha: la última compra hasta ese día inclusive.
 * `history` debe venir ordenada de la compra más vieja a la más nueva (a igual fecha, gana la última).
 */
export function pricesAsOf(history: DatedPrice[], asOf: IsoDate): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of history) {
    if (p.date > asOf) continue;
    out.set(p.ingredientId, p.unitPriceNet);
  }
  return out;
}

export interface ExpiringLotInput {
  /** Identifica el lote (código de lote). */
  lot: string;
  name: string;
  expiryDate: IsoDate | null;
  qty: number;
}

export interface ExpiringLot extends ExpiringLotInput {
  /** Días hasta el vencimiento (negativo = ya venció). */
  daysLeft: number;
}

/**
 * Lotes con saldo que vencen dentro de `withinDays` días (o ya vencieron), el que vence primero va primero.
 * Ignora los lotes sin vencimiento (envases) y los sin saldo.
 */
export function expiringLots(lots: ExpiringLotInput[], today: IsoDate, withinDays: number): ExpiringLot[] {
  return lots
    .filter((l): l is ExpiringLotInput & { expiryDate: IsoDate } => l.expiryDate != null && l.qty > 0)
    .map((l) => ({ ...l, daysLeft: diffDays(l.expiryDate, today) }))
    .filter((l) => l.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name, "es"));
}

/** Días de cobertura a los que se llega al punto de pedido: punto de pedido ÷ consumo diario. null sin consumo. */
export function reorderPointDays(reorderPoint: number, avgDailyConsumption: number): number | null {
  return avgDailyConsumption > 0 ? roundTo(reorderPoint / avgDailyConsumption, 1) : null;
}

/** Porcentaje de `part` sobre `total` con 1 decimal; null si `total` es 0. */
export function sharePct(part: number, total: number): number | null {
  return total > 0 ? roundTo((part / total) * 100, 1) : null;
}

export interface PriceStep {
  ingredientId: string;
  name: string;
  /** Fecha de la última compra. */
  date: IsoDate;
  price: number;
  /** Precio de la compra anterior (mismo proveedor). */
  previousPrice: number;
}

/**
 * Insumos cuyo último precio de compra subió más de `thresholdPct` % contra la compra anterior, en compras de
 * los últimos `days` días (la última compra debe ser reciente). El mayor aumento primero.
 */
export function priceIncreases(
  steps: PriceStep[],
  today: IsoDate,
  opts: { thresholdPct: number; days: number },
): (PriceStep & { pct: number })[] {
  const since = addDays(today, -opts.days);
  return steps
    .filter((s) => s.date >= since && s.date <= today)
    .map((s) => ({ ...s, pct: priceVariationPct(s.previousPrice, s.price) }))
    .filter((s): s is PriceStep & { pct: number } => s.pct != null && s.pct > opts.thresholdPct)
    .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name, "es"));
}
