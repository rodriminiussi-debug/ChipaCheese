import { formatNumber } from "@chipa/domain";

/** Monto compacto para ejes y etiquetas de gráficos: "$ 1,1 M", "-$ 386 mil", "$ 950". */
export function compactMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$ ${formatNumber(a / 1_000_000, a >= 10_000_000 ? 0 : 1)} M`;
  if (a >= 1_000) return `${sign}$ ${formatNumber(a / 1_000, 0)} mil`;
  return `${sign}$ ${formatNumber(a, 0)}`;
}

/** Porcentaje con signo explícito para variaciones: "+2,7 %", "−5,0 %". */
export function signedPct(n: number | null | undefined, decimals = 1): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${formatNumber(Math.abs(n), decimals)} %`;
}

/** "2026-09" → "septiembre de 2026" (para títulos). */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const name = new Intl.DateTimeFormat("es-AR", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
  return `${name} de ${y}`;
}

/** "2026-09" → "sep 26" (para ejes). */
export function monthShort(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const name = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, 1)))
    .replace(".", "");
  return `${name} ${String(y).slice(2)}`;
}
