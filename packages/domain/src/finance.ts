import { DAILY_CAPACITY_KG } from "./constants";
import type { IsoDate } from "./dates";
import { roundMoney, roundTo } from "./units";

/**
 * RF-40: resultado mensual. ventas = Σ por canal; margen bruto = ventas − costo de ventas;
 * resultado = margen bruto − mano de obra − fijos − reparto − otros.
 * `resultPct` = resultado ÷ ventas × 100 (2 decimales), null si no hubo ventas.
 */
export function monthlyResult(input: {
  salesByChannel: Record<string, number>;
  costOfSales: number;
  labor: number;
  fixed: number;
  delivery: number;
  other?: number;
}): { sales: number; grossMargin: number; result: number; resultPct: number | null } {
  const sales = roundMoney(Object.values(input.salesByChannel).reduce((a, b) => a + b, 0));
  const grossMargin = roundMoney(sales - input.costOfSales);
  const result = roundMoney(grossMargin - input.labor - input.fixed - input.delivery - (input.other ?? 0));
  return {
    sales,
    grossMargin,
    result,
    resultPct: sales > 0 ? roundTo((result / sales) * 100, 2) : null,
  };
}

/**
 * Indicador "Uso de capacidad" = kg producidos ÷ (días × 150 kg) × 100, 1 decimal.
 * null si `days` o la capacidad no son positivos.
 */
export function capacityUsagePct(
  producedKg: number,
  days: number,
  capacityKg: number = DAILY_CAPACITY_KG,
): number | null {
  if (!(days > 0) || !(capacityKg > 0)) return null;
  return roundTo((producedKg / (days * capacityKg)) * 100, 1);
}

/**
 * Indicador "Entregas a tiempo y completas" = pedidos entregados en fecha y completos
 * ÷ pedidos entregados × 100 (1 decimal). Los no entregados no cuentan. null si no hay entregas.
 */
export function onTimeInFullRate(
  orders: { promisedDate: IsoDate; deliveredDate: IsoDate | null; complete: boolean }[],
): number | null {
  const delivered = orders.filter((o) => o.deliveredDate !== null);
  if (delivered.length === 0) return null;
  const ok = delivered.filter((o) => (o.deliveredDate as IsoDate) <= o.promisedDate && o.complete).length;
  return roundTo((ok / delivered.length) * 100, 1);
}
