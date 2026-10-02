import { BAG_KG } from "./constants";

/**
 * Redondea half-away-from-zero a `decimals` decimales, corrigiendo el error
 * de representación binaria (1,005 → 1,01). Valores no finitos se devuelven tal cual.
 */
export function roundTo(n: number, decimals: number): number {
  if (!Number.isFinite(n)) return n;
  const factor = 10 ** decimals;
  const abs = Math.abs(n);
  const r = (Math.sign(n) * Math.round(abs * factor * (1 + Number.EPSILON))) / factor;
  return r === 0 ? 0 : r; // normaliza -0
}

/** Dinero en ARS: siempre redondeado a 2 decimales. */
export function roundMoney(n: number): number {
  return roundTo(n, 2);
}

/** Cantidades (kg, litros, unidades): siempre redondeadas a 3 decimales. */
export function roundQty(n: number): number {
  return roundTo(n, 3);
}

/**
 * Regla 3: bolsas equivalentes = kg ÷ peso de bolsa (0,5 kg por defecto).
 * Ej.: 425 kg → 850 bolsas; 148,5 kg → 297 bolsas.
 */
export function bagsEquivalent(kg: number, bagKg: number = BAG_KG): number {
  if (!(bagKg > 0)) throw new RangeError("bagKg must be > 0");
  return roundQty(kg / bagKg);
}

/** Inverso de {@link bagsEquivalent}: kg = bolsas × peso de bolsa. */
export function kgFromBags(bags: number, bagKg: number = BAG_KG): number {
  return roundQty(bags * bagKg);
}
