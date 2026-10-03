import { parseDecimalAR } from "@chipa/domain";

/** Helpers de formularios (cliente y servidor): números en formato de input argentino. */

/** 1234.5 → "1234,5" (coma decimal, sin separador de miles: `parseDecimalAR` lo lee sin ambigüedad). */
export const toInput = (n: number | null | undefined): string => (n == null ? "" : String(n).replace(".", ","));

/** Valor de un input ("1.234,5" o 1234.5) a número; vacío o inválido → 0. */
export function numberOf(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  return typeof v === "string" ? (parseDecimalAR(v) ?? 0) : 0;
}
