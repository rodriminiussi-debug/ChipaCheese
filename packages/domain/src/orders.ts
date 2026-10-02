import { DAILY_CAPACITY_KG } from "./constants";
import { addDays, diffDays, isoWeekday, isWorkday, type IsoDate } from "./dates";
import { roundMoney, roundQty, roundTo } from "./units";

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

/** Estados en los que el pedido todavía necesita producto terminado (no salió del depósito). */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ["received", "confirmed", "in_production", "ready"];

/** Estados en los que se pueden editar los ítems del pedido (RF-03). */
export const EDITABLE_ORDER_STATUSES: readonly OrderStatus[] = ["received", "confirmed"];

/** Estados que ya cumplieron la entrega (o la cancelaron): un pedido así nunca está "atrasado". */
const DELIVERY_DONE: readonly OrderStatus[] = ["delivered", "invoiced", "paid", "cancelled"];

/** RF-03: ¿se pueden modificar los ítems del pedido? Solo recibido o confirmado. */
export function isOrderEditable(status: OrderStatus): boolean {
  return EDITABLE_ORDER_STATUSES.includes(status);
}

/** RF-03: pedido atrasado = fecha comprometida anterior a hoy y todavía no entregado (ni cancelado). */
export function isOrderOverdue(input: { promisedDate: IsoDate; status: OrderStatus; today: IsoDate }): boolean {
  return !DELIVERY_DONE.includes(input.status) && input.promisedDate < input.today;
}

/**
 * RF-02: fecha de entrega por defecto = el primer día de entrega (1 = lunes … 7 = domingo) desde
 * mañana. Sin días de entrega definidos devuelve mañana.
 */
export function nextDeliveryDate(input: { today: IsoDate; weekdays: number[] }): IsoDate {
  const tomorrow = addDays(input.today, 1);
  const valid = input.weekdays.filter((d) => d >= 1 && d <= 7);
  if (valid.length === 0) return tomorrow;
  for (let offset = 0; offset < 7; offset++) {
    const day = addDays(tomorrow, offset);
    if (valid.includes(isoWeekday(day))) return day;
  }
  return tomorrow;
}

/**
 * RF-02: precio vigente = el de `validFrom` más reciente que no sea posterior a `today`.
 * Los precios con vigencia futura no se usan. Devuelve null si ninguno rige todavía.
 */
export function currentUnitPrice(
  prices: { validFrom: IsoDate; unitPrice: number }[],
  today: IsoDate,
): number | null {
  let best: { validFrom: IsoDate; unitPrice: number } | null = null;
  for (const p of prices) {
    if (p.validFrom <= today && (!best || p.validFrom > best.validFrom)) best = p;
  }
  return best ? best.unitPrice : null;
}

/** Total de un pedido en ARS = Σ unidades × precio unitario congelado. */
export function orderTotal(items: { qtyUnits: number; unitPrice: number }[]): number {
  return roundMoney(items.reduce((acc, i) => acc + i.qtyUnits * i.unitPrice, 0));
}

/**
 * RF-05: reparte `backlogKg` (producción ya debida a otros pedidos abiertos) en los primeros días
 * hábiles con capacidad libre desde `today`, y devuelve los kg comprometidos por fecha resultantes.
 * Lo que no entra en `maxDays` se descarta (el estimador devolverá fecha nula de todos modos).
 */
export function allocateBacklogKg(input: {
  backlogKg: number;
  today: IsoDate;
  capacityKg?: number;
  committedKgByDate?: Record<IsoDate, number>;
  workdays?: number[];
  maxDays?: number;
}): Record<IsoDate, number> {
  const capacity = input.capacityKg ?? DAILY_CAPACITY_KG;
  const workdays = input.workdays ?? [1, 2, 3, 4, 5];
  const maxDays = input.maxDays ?? 60;
  const result: Record<IsoDate, number> = { ...(input.committedKgByDate ?? {}) };
  let remaining = roundQty(input.backlogKg);
  for (let offset = 0; offset < maxDays && remaining > 0; offset++) {
    const day = addDays(input.today, offset);
    if (!isWorkday(day, workdays)) continue;
    const free = roundQty(capacity - (result[day] ?? 0));
    if (free <= 0) continue;
    const kg = Math.min(free, remaining);
    result[day] = roundQty((result[day] ?? 0) + kg);
    remaining = roundQty(remaining - kg);
  }
  return result;
}
