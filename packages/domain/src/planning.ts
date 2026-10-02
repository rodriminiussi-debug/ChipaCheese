import { DAILY_CAPACITY_KG, MIN_BATCH_KG } from "./constants";
import { roundQty } from "./units";

export interface ShapeDemand {
  shape: string;
  pendingKg: number;
  stockKg: number;
  minStockKg: number;
}

/**
 * RF-19: plan diario sugerido de producción por forma (tapitas, aritos, lengüitas…).
 *
 * - Necesidad por forma = max(0, pendiente + stock mínimo − stock).
 * - Si la necesidad total es 0 no se produce nada (0 kg es una carga válida).
 * - Si 0 < total < mínimo por tanda (Regla 1) se sube a `minBatchKg` repartiendo en
 *   proporción a la necesidad.
 * - Si supera la capacidad del abatidor (Regla 1) se recorta proporcionalmente a
 *   `capacityKg` y la diferencia se informa en `unmetKg`.
 * - Se redondea a 0,1 kg con el método del mayor resto, de modo que Σ byShape = totalKg.
 *   `byShape` conserva el orden de entrada e incluye formas con 0 kg.
 */
export function suggestDailyPlan(input: {
  demands: ShapeDemand[];
  capacityKg?: number;
  minBatchKg?: number;
}): { totalKg: number; byShape: { shape: string; kg: number }[]; unmetKg: number } {
  const capacity = input.capacityKg ?? DAILY_CAPACITY_KG;
  const minBatch = Math.min(input.minBatchKg ?? MIN_BATCH_KG, capacity);

  const needs = input.demands.map((d) => Math.max(0, d.pendingKg + d.minStockKg - d.stockKg));
  const totalNeed = needs.reduce((a, b) => a + b, 0);

  if (totalNeed <= 0) {
    return {
      totalKg: 0,
      byShape: input.demands.map((d) => ({ shape: d.shape, kg: 0 })),
      unmetKg: 0,
    };
  }

  const target = Math.min(Math.max(totalNeed, minBatch), capacity);
  const unmetKg = roundQty(Math.max(0, totalNeed - capacity));

  // Reparto en décimas de kg (enteros) por mayor resto.
  const totalTenths = Math.round(target * 10);
  const raw = needs.map((n) => (n / totalNeed) * totalTenths);
  const floors = raw.map((r) => Math.floor(r));
  let leftover = totalTenths - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (leftover <= 0) break;
    floors[i] = (floors[i] as number) + 1;
    leftover--;
  }

  return {
    totalKg: totalTenths / 10,
    byShape: input.demands.map((d, i) => ({ shape: d.shape, kg: (floors[i] as number) / 10 })),
    unmetKg,
  };
}
