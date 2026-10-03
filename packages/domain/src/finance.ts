import { DAILY_CAPACITY_KG } from "./constants";
import { costPerBag, type CostLine } from "./costing";
import { addDays, diffDays, isWorkday, type IsoDate } from "./dates";
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

/**
 * RF-40: ¿el resultado del mes cubre los retiros de los socios? `difference` = resultado − retiros
 * (negativo = falta plata); `coveragePct` = resultado ÷ retiros × 100 (1 decimal), null si no hay retiros.
 */
export function withdrawalsCoverage(
  result: number,
  withdrawals: number,
): { covers: boolean; difference: number; coveragePct: number | null } {
  return {
    covers: result >= withdrawals,
    difference: roundMoney(result - withdrawals),
    coveragePct: withdrawals > 0 ? roundTo((result / withdrawals) * 100, 1) : null,
  };
}

/** Cantidad de días hábiles entre `from` y `to` (ambos inclusive). 0 si `to` < `from`. */
export function workdaysBetween(from: IsoDate, to: IsoDate, workdays: number[] = [1, 2, 3, 4, 5]): number {
  const n = diffDays(to, from);
  let count = 0;
  for (let i = 0; i <= n; i++) if (isWorkday(addDays(from, i), workdays)) count++;
  return count;
}

/**
 * Un pedido se entregó completo si de cada producto se despachó al menos lo pedido.
 * Sin líneas → true (nada que incumplir).
 */
export function deliveryIsComplete(lines: { ordered: number; dispatched: number }[]): boolean {
  return lines.every((l) => l.dispatched >= l.ordered);
}

/** Variación porcentual de `before` a `after` (2 decimales). null si `before` es 0. */
export function pctChange(before: number, after: number): number | null {
  if (before === 0) return null;
  return roundTo(((after - before) / Math.abs(before)) * 100, 2);
}

export interface UnitCostSimulation {
  ingredientsCostPerKg: number;
  costPerKg: number;
  componentsCost: number;
  unitCost: number;
}

/**
 * Simulador de sensibilidad (RF-39): costo de un producto si el precio de algunos insumos cambia N %.
 * Misma cuenta que la Regla 8: (Σ cantidad por producción × precio + mano de obra) ÷ kg producidos,
 * × peso neto + componentes (envase, jamón…). `changesPct[ingredientId]` = variación del precio en %
 * (−5 = baja 5 %); afecta tanto a los insumos de la receta como a los componentes de la unidad.
 * Con `changesPct` vacío reproduce exactamente el costo actual.
 */
export function simulateUnitCost(input: {
  /** Insumos de la receta: cantidad por producción (75 kg de fécula) y último precio sin IVA. */
  recipeLines: CostLine[];
  laborPerRun: number;
  producedKgPerRun: number;
  /** Componentes por unidad (envase, jamón, queso feteado): cantidad por unidad y precio sin IVA. */
  components: CostLine[];
  netWeightKg: number;
  changesPct: Record<string, number>;
}): UnitCostSimulation {
  if (!(input.producedKgPerRun > 0)) throw new RangeError("producedKgPerRun must be > 0");
  const factor = (id: string) => 1 + (input.changesPct[id] ?? 0) / 100;
  const ingredientsRun = input.recipeLines.reduce(
    (a, l) => a + l.qty * l.unitPriceNet * factor(l.ingredientId),
    0,
  );
  const costPerKg = roundMoney((ingredientsRun + input.laborPerRun) / input.producedKgPerRun);
  const componentsCost = roundMoney(
    input.components.reduce((a, c) => a + c.qty * c.unitPriceNet * factor(c.ingredientId), 0),
  );
  return {
    ingredientsCostPerKg: roundMoney(ingredientsRun / input.producedKgPerRun),
    costPerKg,
    componentsCost,
    unitCost: costPerBag({ costPerKg, bagKg: input.netWeightKg, packagingCostPerBag: componentsCost }),
  };
}
