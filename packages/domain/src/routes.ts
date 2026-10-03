import { isoWeekday, type IsoDate } from "./dates";
import { roundMoney, roundQty } from "./units";

/**
 * RF-26/27: costo de una salida de reparto.
 *
 * total = combustible + horas × costo horario del chofer + otros.
 * El componente combustible es `fuelCost` si viene informado (gasto real cargado);
 * si no, se estima como `km × costPerKm`. Nunca se suman ambos (evita doble conteo).
 * Lanza error si `kmEnd < kmStart`.
 */
export function routeCost(input: {
  kmStart: number;
  kmEnd: number;
  costPerKm: number;
  hours: number;
  driverHourlyCost: number;
  fuelCost?: number;
  otherCosts?: number;
}): { km: number; total: number } {
  const km = roundQty(input.kmEnd - input.kmStart);
  if (km < 0) throw new RangeError("kmEnd must be >= kmStart");
  const fuel = input.fuelCost ?? km * input.costPerKm;
  const total = fuel + input.hours * input.driverHourlyCost + (input.otherCosts ?? 0);
  return { km, total: roundMoney(total) };
}

/** RF-27: costo por kg entregado = costo de la ruta ÷ kg entregados; null si no se entregó nada. */
export function costPerKgDelivered(routeTotal: number, kgDelivered: number): number | null {
  if (!(kgDelivered > 0)) return null;
  return roundMoney(routeTotal / kgDelivered);
}

/** Umbral de "ruta chica": por debajo de estos kg entregados la ruta probablemente no se paga (la del 30/09 salió con 25 kg). */
export const SMALL_ROUTE_KG = 50;

/** RF-27: ¿es una ruta chica? Solo tiene sentido con kg conocidos (ruta entregada). */
export function isSmallRoute(kgDelivered: number, threshold: number = SMALL_ROUTE_KG): boolean {
  return kgDelivered < threshold;
}

/** RF-26: horas de una salida (fin − inicio), con 2 decimales; nunca negativas. */
export function routeHours(startedAt: Date, endedAt: Date): number {
  const hours = (endedAt.getTime() - startedAt.getTime()) / 3_600_000;
  return Math.max(0, Math.round(hours * 100) / 100);
}

/**
 * RF-24: ¿la zona reparte ese día? `weekdays` son días ISO 1..7. Una zona sin días definidos
 * no restringe (todavía no se fijaron los días de reparto): devuelve true.
 */
export function zoneDeliversOn(weekdays: readonly number[], date: IsoDate): boolean {
  return weekdays.length === 0 || weekdays.includes(isoWeekday(date));
}
