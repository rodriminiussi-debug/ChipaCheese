import { DAILY_CAPACITY_KG } from "./constants";
import { addDays, diffDays, isWorkday, type IsoDate } from "./dates";
import { roundQty, roundTo } from "./units";

/** RF-03: estados del pedido, en orden de avance. */
export const ORDER_STATUSES = [
  "received",
  "confirmed",
  "in_production",
  "ready",
  "dispatched",
  "delivered",
  "invoiced",
  "paid",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Estados desde los cuales ya no se puede cancelar. */
const NON_CANCELLABLE: readonly OrderStatus[] = ["delivered", "invoiced", "paid", "cancelled"];

/**
 * RF-03: transición válida de estado. Avance secuencial (se permite saltar estados
 * hacia adelante, p. ej. ready → delivered); nunca retrocede; se puede cancelar desde
 * cualquier estado salvo delivered/invoiced/paid; `paid` y `cancelled` son finales.
 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to || from === "cancelled") return false;
  if (to === "cancelled") return !NON_CANCELLABLE.includes(from);
  return ORDER_STATUSES.indexOf(to) > ORDER_STATUSES.indexOf(from);
}

/** Estados a los que puede pasar un pedido desde `from`. */
export function nextStatuses(from: OrderStatus): OrderStatus[] {
  return ORDER_STATUSES.filter((to) => canTransition(from, to));
}

/** Peso total de un pedido en kg = Σ unidades × peso neto por unidad. */
export function orderKg(items: { qtyUnits: number; netWeightKg: number }[]): number {
  return roundQty(items.reduce((acc, i) => acc + i.qtyUnits * i.netWeightKg, 0));
}

/**
 * RF-04: frecuencia promedio de compra = promedio de días entre pedidos consecutivos
 * (ordenados por fecha). Con menos de 2 pedidos devuelve null.
 */
export function averageOrderIntervalDays(orderDates: IsoDate[]): number | null {
  if (orderDates.length < 2) return null;
  const sorted = [...orderDates].sort();
  let total = 0;
  for (let i = 1; i < sorted.length; i++) {
    total += diffDays(sorted[i] as IsoDate, sorted[i - 1] as IsoDate);
  }
  return roundTo(total / (sorted.length - 1), 2);
}

/** RF-04: días desde el último pedido hasta `today`; null si no hay pedidos. */
export function daysSinceLastOrder(orderDates: IsoDate[], today: IsoDate): number | null {
  if (orderDates.length === 0) return null;
  const last = [...orderDates].sort()[orderDates.length - 1] as IsoDate;
  return diffDays(today, last);
}

/**
 * RF-04: aviso de "cliente sin pedir hace X días". Verdadero si los días desde el
 * último pedido superan el intervalo promedio × `toleranceFactor` (1,5 por defecto).
 * Sin historial suficiente (< 2 pedidos) no hay frecuencia y devuelve false.
 */
export function isCustomerOverdue(input: {
  orderDates: IsoDate[];
  today: IsoDate;
  toleranceFactor?: number;
}): boolean {
  const avg = averageOrderIntervalDays(input.orderDates);
  const since = daysSinceLastOrder(input.orderDates, input.today);
  if (avg === null || since === null) return false;
  return since > avg * (input.toleranceFactor ?? 1.5);
}

/**
 * Regla 10 / RF-05: fecha posible de un pedido grande.
 *
 * - Si el stock terminado alcanza, la fecha es `today` y no hay producción.
 * - Si no, se produce el faltante en días hábiles desde `today` (inclusive) usando la
 *   capacidad libre de cada día (`capacity − committed`). El producto queda disponible
 *   `freezeDays` días corridos después del último día de producción (congelado nocturno
 *   en el abatidor; default 1).
 * - `schedule` lista los kg asignados a cada día de producción.
 * - Si no alcanza dentro de `maxDays` días corridos (default 60) devuelve `date: null`
 *   (con el `schedule` parcial).
 *
 * Ej.: 425 kg, stock 0, capacidad 150, desde un lunes → 150 + 150 + 125 (lun, mar, mié)
 * y fecha = jueves.
 */
export function estimateBigOrderDate(input: {
  orderKg: number;
  finishedStockKg: number;
  today: IsoDate;
  capacityKg?: number;
  committedKgByDate?: Record<IsoDate, number>;
  workdays?: number[];
  maxDays?: number;
  freezeDays?: number;
}): { date: IsoDate | null; schedule: { date: IsoDate; kg: number }[] } {
  const capacity = input.capacityKg ?? DAILY_CAPACITY_KG;
  const committed = input.committedKgByDate ?? {};
  const workdays = input.workdays ?? [1, 2, 3, 4, 5];
  const maxDays = input.maxDays ?? 60;
  const freezeDays = input.freezeDays ?? 1;

  let remaining = roundQty(input.orderKg - input.finishedStockKg);
  const schedule: { date: IsoDate; kg: number }[] = [];
  if (remaining <= 0) return { date: input.today, schedule };

  for (let offset = 0; offset < maxDays; offset++) {
    const day = addDays(input.today, offset);
    if (!isWorkday(day, workdays)) continue;
    const free = roundQty(capacity - (committed[day] ?? 0));
    if (free <= 0) continue;
    const kg = Math.min(free, remaining);
    schedule.push({ date: day, kg });
    remaining = roundQty(remaining - kg);
    if (remaining <= 0) return { date: addDays(day, freezeDays), schedule };
  }
  return { date: null, schedule };
}
