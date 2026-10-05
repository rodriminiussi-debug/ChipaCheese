import { addDays, formatNumber, pctChange, type IsoDate } from "@chipa/domain";
import { signedPct } from "@/features/finance/format";

/**
 * Lecturas de los gráficos del tablero: la frase que va de subtítulo y de descripción accesible de cada uno
 * ("Septiembre: $ 18,3 M, +2,0 % vs agosto"). Funciones puras sobre las series del servicio.
 */

/** "septiembre" (nombre del mes en minúscula). */
export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("es-AR", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "lun 28" para el eje de los gráficos diarios (fecha de negocio, sin corrimientos de huso). */
export function dayLabel(date: IsoDate): string {
  const wd = new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(".", "");
  return `${wd} ${Number(date.slice(8, 10))}`;
}

/** "28/09" */
export function shortDate(date: IsoDate): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** Monto para frases: "$ 18,3 M", "$ 583 mil", "-$ 1,1 M", "$ 950". */
export function moneyShort(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$ ${formatNumber(a / 1_000_000, 1)} M`;
  if (a >= 1_000) return `${sign}$ ${formatNumber(a / 1_000, 0)} mil`;
  return `${sign}$ ${formatNumber(a, 0)}`;
}

/** "+2,0 % vs agosto"; si el mes anterior no tiene dato, lo dice. */
function versus(cur: number | null, prev: number | null, prevMonthName: string): string {
  if (cur == null || prev == null || prev === 0) return `sin dato de ${prevMonthName} para comparar`;
  return `${signedPct(pctChange(prev, cur))} vs ${prevMonthName}`;
}

// ------------------------------------------------------------------------------------------------
// Dirección
// ------------------------------------------------------------------------------------------------

export function salesReading(series: { month: string; total: number }[]): string {
  const cur = series.at(-1);
  if (!cur || cur.total === 0)
    return `${capitalize(monthName(cur?.month ?? "2000-01"))}: sin ventas facturadas.`;
  const prev = series.at(-2);
  return `${capitalize(monthName(cur.month))}: ${moneyShort(cur.total)}, ${versus(cur.total, prev?.total ?? null, prev ? monthName(prev.month) : "el mes anterior")}`;
}

export function resultReading(input: {
  month: string;
  result: number;
  resultPct: number | null;
  withdrawals: number;
  hasData: boolean;
}): string {
  const m = capitalize(monthName(input.month));
  if (!input.hasData) return `${m}: sin datos cargados.`;
  const sign = input.result > 0 ? "+" : "";
  const pct = input.resultPct != null ? ` (${formatNumber(input.resultPct, 1)} % de las ventas)` : "";
  const gap = input.result - input.withdrawals;
  const covers =
    gap >= 0
      ? `cubre los retiros de ${moneyShort(input.withdrawals)}`
      : `no cubre los retiros de ${moneyShort(input.withdrawals)}: faltan ${moneyShort(-gap)}`;
  return `${m}: ${sign}${moneyShort(input.result)}${pct}; ${covers}.`;
}

export function marginReading(
  rows: { listName: string; avgMarginPct: number | null; targetMarginPct: number }[],
): string {
  const withData = rows.filter((r) => r.avgMarginPct != null);
  if (withData.length === 0) return "Sin precios con costo completo para calcular márgenes.";
  const under = withData
    .filter((r) => r.avgMarginPct! < r.targetMarginPct)
    .sort((a, b) => a.avgMarginPct! - a.targetMarginPct - (b.avgMarginPct! - b.targetMarginPct));
  if (under.length === 0) return "Todos los canales cumplen su margen objetivo.";
  const worst = under[0]!;
  const gap = worst.targetMarginPct - worst.avgMarginPct!;
  return `${under.length} de ${withData.length} canales bajo el objetivo; el más lejos: ${worst.listName}, ${formatNumber(worst.avgMarginPct!, 1)} % contra ${formatNumber(worst.targetMarginPct, 0)} % (−${formatNumber(gap, 1)} pts).`;
}

export function topCustomersReading(
  month: string,
  customers: { name: string; net: number }[],
  salesNet: number,
): string {
  const m = capitalize(monthName(month));
  const first = customers[0];
  if (!first) return `${m}: todavía no hay facturas.`;
  const top = customers.reduce((a, c) => a + c.net, 0);
  const share =
    salesNet > 0
      ? `; los ${customers.length} primeros suman el ${formatNumber((top / salesNet) * 100, 0)} % de las ventas`
      : "";
  return `${m}: ${first.name} lidera con ${moneyShort(first.net)}${share}.`;
}

export function agingReading(a: {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total: number;
}): string {
  if (a.total <= 0) return "Hoy no hay deuda de clientes.";
  const overdue = a.total - a.current;
  if (overdue <= 0) return `${moneyShort(a.total)} por cobrar, todo dentro del plazo.`;
  const old = a.d61_90 + a.d90_plus;
  const tail = old > 0 ? `; ${moneyShort(old)} pasa de 60 días` : "; nada pasa de 60 días";
  return `${moneyShort(a.total)} por cobrar, ${moneyShort(overdue)} ya vencidos (${formatNumber((overdue / a.total) * 100, 0)} %)${tail}.`;
}

export function monthlyValueReading(
  series: { month: string; value: number | null }[],
  fmt: (n: number) => string,
  what: string,
): string {
  const cur = series.at(-1);
  if (!cur || cur.value == null) {
    const first = series.find((s) => s.value != null);
    return first
      ? `${capitalize(monthName(cur?.month ?? first.month))}: sin dato de ${what}.`
      : `Todavía no hay datos de ${what}.`;
  }
  const prev = series.at(-2);
  return `${capitalize(monthName(cur.month))}: ${fmt(cur.value)}, ${versus(cur.value, prev?.value ?? null, prev ? monthName(prev.month) : "el mes anterior")}`;
}

export function zoneReading(
  month: string,
  zones: { zone: string; costPerKg: number | null }[],
  fmt: (n: number) => string,
): string {
  const priced = zones.filter((z): z is { zone: string; costPerKg: number } => z.costPerKg != null);
  if (priced.length === 0) return `${capitalize(monthName(month))}: sin entregas con costo de reparto.`;
  const sorted = [...priced].sort((a, b) => b.costPerKg - a.costPerKg);
  if (sorted.length === 1)
    return `${capitalize(monthName(month))}: ${sorted[0]!.zone}, ${fmt(sorted[0]!.costPerKg)} por kg.`;
  const hi = sorted[0]!;
  const lo = sorted.at(-1)!;
  return `${capitalize(monthName(month))}: ${hi.zone} es la más cara (${fmt(hi.costPerKg)}/kg) y ${lo.zone} la más barata (${fmt(lo.costPerKg)}/kg).`;
}

// ------------------------------------------------------------------------------------------------
// Operativo
// ------------------------------------------------------------------------------------------------

export function productionReading(input: {
  producedKg: number;
  workdays: number;
  usagePct: number | null;
  capacityKg: number;
  daily: { kg: number }[];
}): string {
  const days = input.daily.filter((d) => d.kg > 0);
  const total = input.daily.reduce((a, d) => a + d.kg, 0);
  const week =
    input.usagePct != null
      ? `Esta semana: ${formatNumber(input.producedKg, 1)} kg, ${formatNumber(input.usagePct, 0)} % de la capacidad de ${input.workdays} día(s) hábil(es)`
      : `Esta semana: ${formatNumber(input.producedKg, 1)} kg`;
  const avg =
    days.length > 0
      ? `; promedio de ${formatNumber(total / days.length, 0)} kg por día producido (tope ${input.capacityKg})`
      : "";
  return `${week}${avg}.`;
}

export function yieldReading(
  points: { yieldPct: number; weighedKg: number; ingredientsKg: number }[],
): string {
  if (points.length === 0)
    return "Todavía no hay producciones con pesadas y consumos para medir el rendimiento.";
  const avg =
    (points.reduce((a, p) => a + p.weighedKg, 0) / points.reduce((a, p) => a + p.ingredientsKg, 0)) * 100;
  const last = points.at(-1)!;
  const prev = points.at(-2);
  const delta = prev
    ? `, ${last.yieldPct >= prev.yieldPct ? "+" : "−"}${formatNumber(Math.abs(last.yieldPct - prev.yieldPct), 1)} pts vs la anterior`
    : "";
  return `Promedio de ${points.length} producción(es): ${formatNumber(avg, 1)} %; la última rindió ${formatNumber(last.yieldPct, 1)} %${delta}.`;
}

export function coverageReading(
  items: { name: string; coverageDays: number | null; reorderDays: number | null; status: string }[],
): string {
  if (items.length === 0) return "Todavía no hay insumos con consumo para calcular la cobertura.";
  const below = items.filter((i) => i.status === "reorder" || i.status === "out_of_stock");
  if (below.length === 0) {
    const min = items[0]!;
    return `Todos sobre el punto de pedido; el que menos cubre es ${min.name}, ${formatNumber(min.coverageDays ?? 0, 0)} días.`;
  }
  const names = below
    .slice(0, 3)
    .map((b) => b.name)
    .join(", ");
  return `${below.length} bajo el punto de pedido: ${names}${below.length > 3 ? "…" : ""}.`;
}

export function otifReading(
  weeks: { weekFrom: IsoDate; pct: number | null; delivered: number; ok: number }[],
): string {
  const withData = weeks.filter((w) => w.delivered > 0);
  if (withData.length === 0) return `Sin entregas en las últimas ${weeks.length} semanas.`;
  const last = withData.at(-1)!;
  const delivered = withData.reduce((a, w) => a + w.delivered, 0);
  const ok = withData.reduce((a, w) => a + w.ok, 0);
  return `Última semana con entregas (del ${shortDate(last.weekFrom)}): ${formatNumber(last.pct ?? 0, 0)} %; en ${weeks.length} semanas, ${ok} de ${delivered} pedidos a tiempo y completos.`;
}

export function storeReading(days: { date: IsoDate; units: number }[], today: IsoDate): string {
  const total = days.reduce((a, d) => a + d.units, 0);
  if (total === 0) return `Sin ventas del local en los últimos ${days.length} días.`;
  const open = days.filter((d) => d.units > 0).length;
  const yesterday = days.find((d) => d.date === addDays(today, -1));
  const avg = formatNumber(total / open, 0);
  return `${yesterday ? `Ayer: ${yesterday.units} unidad(es); ` : ""}promedio de ${avg} por día con ventas (${open} de ${days.length} días).`;
}

export function temperatureReading(
  days: { date: IsoDate; readings: number; outOfRange: number }[],
  today: IsoDate,
): string {
  const todayRow = days.find((d) => d.date === today);
  const out = days.reduce((a, d) => a + d.outOfRange, 0);
  const total = days.reduce((a, d) => a + d.readings, 0);
  const hoy = todayRow
    ? `Hoy: ${todayRow.readings} registro(s), ${todayRow.outOfRange} fuera de rango; `
    : "";
  return `${hoy}en ${days.length} días: ${total} registros, ${out} fuera de rango.`;
}
