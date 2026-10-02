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
