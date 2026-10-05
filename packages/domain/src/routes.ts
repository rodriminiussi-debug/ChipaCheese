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

export type CostGap = "vehicle_cost_per_km" | "driver_hourly_cost";

/**
 * RF-27: datos que faltan para que el costo de una ruta sea completo ("costo parcial"):
 * - costo por km del vehículo, si recorrió km y no se cargó el gasto real de combustible (que lo reemplaza);
 * - costo hora del chofer, si la salida tuvo horas.
 */
export function missingCostInputs(input: {
  km: number;
  hours: number;
  costPerKm: number | null;
  hasRealFuelCost: boolean;
  driverHourlyCost: number | null;
}): CostGap[] {
  const gaps: CostGap[] = [];
  if (input.km > 0 && !input.hasRealFuelCost && !((input.costPerKm ?? 0) > 0))
    gaps.push("vehicle_cost_per_km");
  if (input.hours > 0 && !((input.driverHourlyCost ?? 0) > 0)) gaps.push("driver_hourly_cost");
  return gaps;
}

/**
 * RF-27: reparte el costo de una ruta entre sus paradas (o zonas) en proporción a los kg entregados.
 * La suma da exactamente `total` (el redondeo sobrante va a la mayor parte). Sin kg no se reparte nada.
 */
export function allocateCostByKg(
  total: number,
  parts: { key: string; kg: number }[],
): { key: string; kg: number; cost: number }[] {
  const kgTotal = parts.reduce((a, p) => a + Math.max(0, p.kg), 0);
  if (!(kgTotal > 0)) return parts.map((p) => ({ ...p, cost: 0 }));
  const out = parts.map((p) => ({ ...p, cost: roundMoney((total * Math.max(0, p.kg)) / kgTotal) }));
  const diff = roundMoney(total - out.reduce((a, p) => a + p.cost, 0));
  if (diff !== 0) {
    const biggest = out.reduce((m, p) => (p.kg > m.kg ? p : m), out[0]!);
    biggest.cost = roundMoney(biggest.cost + diff);
  }
  return out;
}

/**
 * Rendición del chofer al volver: lo que entrega contra lo que el sistema registró como cobrado en la ruta.
 * Diferencia = entregado − esperado (negativa = falta plata o cheques; positiva = sobra). Tolera centavos.
 */
export interface SettlementDifference {
  /** Entregado − esperado, en pesos. */
  cash: number;
  /** Cheques entregados − esperados, en cantidad. */
  checks: number;
  /** "ok" sin diferencia; "short" si falta efectivo o cheques; "over" si sobra y no falta nada. */
  status: "ok" | "short" | "over";
}

export function settlementDifference(input: {
  cashExpected: number;
  cashDelivered: number;
  checksExpected: number;
  checksDelivered: number;
}): SettlementDifference {
  const cash = roundMoney(input.cashDelivered - input.cashExpected);
  const checks = input.checksDelivered - input.checksExpected;
  const status = cash < 0 || checks < 0 ? "short" : cash > 0 || checks > 0 ? "over" : "ok";
  return { cash, checks, status };
}
