import type { IsoDate } from "./dates";
import { assertIsoDate } from "./dates";
import { roundMoney, roundQty } from "./units";

const cache = new Map<string, Intl.NumberFormat>();

function nf(min: number, max: number): Intl.NumberFormat {
  const key = `${min}:${max}`;
  let f = cache.get(key);
  if (!f) {
    // useGrouping 'always': en es-AR queremos "4.200" también con 4 dígitos.
    f = new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
      useGrouping: "always",
    });
    cache.set(key, f);
  }
  return f;
}

/**
 * Pesos argentinos. Sin `decimals`: 0 decimales si el monto es entero, 2 si no
 * ("$ 4.200", "$ 4.223,68"). Con `decimals`: cantidad fija ("$ 791.930,00").
 */
export function formatARS(n: number, opts?: { decimals?: number }): string {
  const value = roundMoney(n);
  const decimals = opts?.decimals ?? (Number.isInteger(value) ? 0 : 2);
  const sign = value < 0 ? "-" : "";
  return `${sign}$ ${nf(decimals, decimals).format(Math.abs(value))}`;
}

/** Kilogramos con coma decimal y hasta 3 decimales: "149,3 kg". */
export function formatKg(n: number): string {
  return `${nf(0, 3).format(roundQty(n))} kg`;
}

/** Número con separador de miles "." y decimales "," (cantidad fija, default 2). */
export function formatNumber(n: number, decimals = 2): string {
  return nf(decimals, decimals).format(n);
}

/** Fecha ISO → "DD/MM/AAAA". */
export function formatDateAR(d: IsoDate): string {
  assertIsoDate(d);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

/**
 * Interpreta un número escrito en formato argentino o con punto decimal:
 * "1.234,5" → 1234.5; "1234.5" → 1234.5; "1.234" → 1234 (punto de miles);
 * "$ 4.200" → 4200. Cadena vacía o inválida → null.
 */
export function parseDecimalAR(s: string): number | null {
  let t = s.replace(/[\s$]/g, "");
  if (t === "") return null;
  if (t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^[+-]?[1-9]\d{0,2}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  }
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(t)) return null;
  return Number(t);
}
