import { addDays, type IsoDate } from "./dates";
import type { RecipeLine } from "./recipe";
import { roundQty, roundTo } from "./units";

export interface LotBalance {
  lotId: string;
  expiryDate: IsoDate;
  qty: number;
  locationId?: string;
}

export interface FefoAllocation {
  lotId: string;
  qty: number;
  expiryDate: IsoDate;
  locationId?: string;
}

/**
 * Regla 5: vence primero, sale primero (FEFO). Asigna `qtyNeeded` desde los lotes
 * con vencimiento más próximo. Ignora lotes con qty <= 0; desempate estable por lotId.
 * Devuelve el faltante si el stock no alcanza.
 */
export function allocateFefo(
  lots: LotBalance[],
  qtyNeeded: number,
): { allocations: FefoAllocation[]; shortfall: number } {
  const sorted = lots
    .filter((l) => l.qty > 0)
    .sort((a, b) => {
      if (a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1;
      if (a.lotId !== b.lotId) return a.lotId < b.lotId ? -1 : 1;
      return 0;
    });
  const allocations: FefoAllocation[] = [];
  let remaining = Math.max(0, qtyNeeded);
  for (const lot of sorted) {
    if (remaining <= 0) break;
    const take = roundQty(Math.min(lot.qty, remaining));
    allocations.push({
      lotId: lot.lotId,
      qty: take,
      expiryDate: lot.expiryDate,
      ...(lot.locationId !== undefined ? { locationId: lot.locationId } : {}),
    });
    remaining = roundQty(remaining - take);
  }
  return { allocations, shortfall: Math.max(0, roundQty(remaining)) };
}

/**
 * Regla 6 (denominador): consumo diario promedio = suma de consumos en la ventana
 * (today − windowDays, today] ÷ windowDays. `today` se recibe como parámetro.
 */
export function averageDailyConsumption(
  consumptions: { date: IsoDate; qty: number }[],
  today: IsoDate,
  windowDays = 30,
): number {
  if (!(windowDays > 0)) throw new RangeError("windowDays must be > 0");
  const from = addDays(today, -windowDays); // exclusivo
  let sum = 0;
  for (const c of consumptions) {
    if (c.date > from && c.date <= today) sum += c.qty;
  }
  return roundQty(sum / windowDays);
}

/**
 * Regla 6: cobertura (días) = stock ÷ consumo diario promedio, 1 decimal.
 * `null` si el consumo es 0 (cobertura infinita).
 */
export function coverageDays(stock: number, avgDailyConsumption: number): number | null {
  if (avgDailyConsumption <= 0) return null;
  return roundTo(Math.max(0, stock) / avgDailyConsumption, 1);
}

/**
 * Regla 7: punto de pedido = consumo diario × plazo de entrega del proveedor + stock de seguridad.
 */
export function reorderPoint(avgDailyConsumption: number, leadTimeDays: number, safetyStock: number): number {
  return roundQty(avgDailyConsumption * leadTimeDays + safetyStock);
}

/** RF-14: avisar cuando el stock llega (o baja de) al punto de pedido. */
export function needsReorder(stock: number, reorderPointQty: number): boolean {
  return stock <= reorderPointQty;
}

/**
 * RF-17: simulador "¿alcanza la materia prima para producir X kg de fécula?".
 * Compara la necesidad teórica (Regla 2) contra el stock disponible por insumo.
 */
export function canProduce(input: {
  starchKg: number;
  lines: RecipeLine[];
  stockByIngredient: Record<string, number>;
}): {
  ok: boolean;
  missing: { ingredientId: string; needed: number; available: number; shortfall: number }[];
} {
  const missing: { ingredientId: string; needed: number; available: number; shortfall: number }[] = [];
  for (const line of input.lines) {
    const needed = roundQty(line.qtyPerKgStarch * input.starchKg);
    const available = roundQty(input.stockByIngredient[line.ingredientId] ?? 0);
    if (needed > available) {
      missing.push({
        ingredientId: line.ingredientId,
        needed,
        available,
        shortfall: roundQty(needed - available),
      });
    }
  }
  return { ok: missing.length === 0, missing };
}

/**
 * kg de fécula necesarios para obtener `productKg` de producto, dado el rendimiento
 * esperado en kg de producto por kg de fécula (Regla 1: 150 kg ÷ 75 kg = 2).
 */
export function starchKgForProductKg(productKg: number, expectedYieldKgPerKgStarch: number): number {
  if (!(expectedYieldKgPerKgStarch > 0)) {
    throw new RangeError("expectedYieldKgPerKgStarch must be > 0");
  }
  return roundQty(productKg / expectedYieldKgPerKgStarch);
}
