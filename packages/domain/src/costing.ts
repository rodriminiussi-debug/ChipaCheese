import { BAG_KG } from "./constants";
import { roundMoney, roundTo } from "./units";

export interface CostLine {
  ingredientId: string;
  qty: number;
  /** Último precio de compra SIN IVA (Regla 8). */
  unitPriceNet: number;
}

/** Costo de ingredientes = Σ cantidad × último precio neto (Regla 8). */
export function ingredientsCost(lines: CostLine[]): number {
  return roundMoney(lines.reduce((acc, l) => acc + l.qty * l.unitPriceNet, 0));
}

/**
 * Regla 8: costo por kg = (Σ insumo × precio sin IVA + mano de obra) ÷ kg reales producidos.
 * Debe usarse el peso real (p. ej. 149,3 kg), no la suma de ingredientes (error 1 del Excel).
 * Lanza error si `producedKg` <= 0.
 */
export function costPerKg(input: { lines: CostLine[]; producedKg: number; laborCost: number }): number {
  if (!(input.producedKg > 0)) throw new RangeError("producedKg must be > 0");
  const total = input.lines.reduce((acc, l) => acc + l.qty * l.unitPriceNet, 0) + input.laborCost;
  return roundMoney(total / input.producedKg);
}

/** Regla 8: costo por bolsa = costo por kg × peso de bolsa + envase (bolsa + etiqueta). */
export function costPerBag(input: {
  costPerKg: number;
  bagKg?: number;
  packagingCostPerBag: number;
}): number {
  const bagKg = input.bagKg ?? BAG_KG;
  return roundMoney(input.costPerKg * bagKg + input.packagingCostPerBag);
}

/** Mano de obra de una producción = personas × horas × costo horario (4 × 6 × $5.000 = $120.000). */
export function laborCostPerRun(input: { workers: number; hours: number; hourlyCost: number }): number {
  return roundMoney(input.workers * input.hours * input.hourlyCost);
}

/**
 * Regla 9: precio = costo directo ÷ (1 − margen objetivo). El margen se expresa en
 * % sobre el precio (0 ≤ m < 100). Ej.: 3.210 con 24% → 4.223,68.
 */
export function priceForMargin(directCost: number, targetMarginPct: number): number {
  if (!(targetMarginPct >= 0 && targetMarginPct < 100)) {
    throw new RangeError("targetMarginPct must be in [0, 100)");
  }
  return roundMoney(directCost / (1 - targetMarginPct / 100));
}

/** Margen % = (precio − costo) ÷ precio × 100, 2 decimales. Ej.: (4.200, 3.210) → 23,57. */
export function marginPct(price: number, cost: number): number {
  if (!(price > 0)) throw new RangeError("price must be > 0");
  return roundTo(((price - cost) / price) * 100, 2);
}

/** Margen por unidad = precio − costo. */
export function marginPerUnit(price: number, cost: number): number {
  return roundMoney(price - cost);
}
