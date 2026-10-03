const nf = (max: number) =>
  new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: max,
    minimumFractionDigits: 0,
    useGrouping: "always",
  });
const cache = new Map<number, Intl.NumberFormat>();

/** Cantidad con coma decimal y sin ceros de más: 0,3 · 22,5 · 1.250. */
export function fmtQty(n: number, maxDecimals = 3): string {
  let f = cache.get(maxDecimals);
  if (!f) {
    f = nf(maxDecimals);
    cache.set(maxDecimals, f);
  }
  return f.format(n);
}

/** Rango "min – max" (o "—" si no hay). */
export function fmtRange(min: number | null, max: number | null, unit = ""): string {
  if (min == null && max == null) return "—";
  const u = unit ? ` ${unit}` : "";
  if (min != null && max != null) return `${fmtQty(min)} – ${fmtQty(max)}${u}`;
  return min != null ? `≥ ${fmtQty(min)}${u}` : `≤ ${fmtQty(max!)}${u}`;
}

/** Abreviatura de unidad para mostrar junto a cantidades. */
export const UNIT_SHORT: Record<string, string> = { kg: "kg", l: "L", unit: "u." };
