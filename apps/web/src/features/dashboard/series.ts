import {
  addDays,
  deliveryIsComplete,
  lastWeekStarts,
  monthSeriesEnd,
  onTimeInFullRate,
  pricesAsOf,
  productionYield,
  reorderPointDays,
  roundQty,
  roundTo,
  weekStart,
  type IsoDate,
} from "@chipa/domain";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  schema,
  sql,
  type Executor,
} from "@chipa/db";
import { TZ } from "@/lib/dates";
import { getProductCosts, type ProductCosts } from "@/features/costing/service";
import type { IngredientCoverage } from "@/features/stock/service";

/**
 * Series del tablero visual (RF-41): cada función devuelve datos listos para graficar, con la fecha de negocio
 * en hora argentina. Lo que lleva montos (`FinancialCharts`) sólo lo arma `getFinancialDashboard`.
 */

// ------------------------------------------------------------------------------------------------
// Tipos
// ------------------------------------------------------------------------------------------------

export interface YieldPoint {
  runId: string;
  date: IsoDate;
  /** Número de producción del día. */
  runNumber: number;
  weighedKg: number;
  ingredientsKg: number;
  /** kg pesados ÷ kg de ingredientes reales (Regla 3), en porcentaje. */
  yieldPct: number;
}

export interface CoveragePoint {
  ingredientId: string;
  name: string;
  unit: string;
  stock: number;
  coverageDays: number | null;
  /** Días de consumo que cubre el punto de pedido; la barra por debajo de esto hay que reponer. */
  reorderDays: number | null;
  status: string;
}

export interface OtifWeek {
  weekFrom: IsoDate;
  pct: number | null;
  delivered: number;
  ok: number;
}

export interface DailyUnits {
  date: IsoDate;
  units: number;
}

export interface DailyTemperatures {
  date: IsoDate;
  readings: number;
  outOfRange: number;
}

/** Gráficos que ve cualquiera que acceda al tablero: sólo kg, unidades, días y porcentajes (nada de montos). */
export interface OperationalCharts {
  /** Producciones de los últimos `YIELD_CHART_DAYS` días. */
  yieldByRun: YieldPoint[];
  /** Insumos con consumo, del que menos cobertura tiene al que más. */
  coverage: CoveragePoint[];
  otifByWeek: OtifWeek[];
  storeDaily: DailyUnits[];
  temperaturesDaily: DailyTemperatures[];
}

/** Días del gráfico de rendimiento por producción. */
export const YIELD_CHART_DAYS = 45;
/** Semanas del gráfico de entregas a tiempo. */
export const OTIF_CHART_WEEKS = 8;
/** Días de los gráficos diarios del local y de temperaturas. */
export const DAILY_CHART_DAYS = 14;
/** Insumos que muestra el gráfico de cobertura (los de menor cobertura). */
export const COVERAGE_CHART_ITEMS = 12;

// ------------------------------------------------------------------------------------------------
// Rendimiento por producción
// ------------------------------------------------------------------------------------------------

/**
 * Rendimiento (Regla 3) de cada producción no cancelada entre `from` y `to` inclusive: kg pesados ÷ kg de
 * ingredientes reales consumidos. Las que no tienen pesadas o consumos no se pueden medir y no aparecen.
 */
export async function getYieldByRun(db: Executor, from: IsoDate, to: IsoDate): Promise<YieldPoint[]> {
  const r = schema.productionRuns;
  const runs = db
    .select({ id: r.id })
    .from(r)
    .where(and(gte(r.date, from), lt(r.date, addDays(to, 1)), sql`${r.status} <> 'cancelled'`));
  const [weighed, consumed, meta] = await Promise.all([
    db
      .select({
        runId: schema.productionWeighings.runId,
        kg: sql<number>`sum(${schema.productionWeighings.kg})::float8`,
      })
      .from(schema.productionWeighings)
      .where(inArray(schema.productionWeighings.runId, runs))
      .groupBy(schema.productionWeighings.runId),
    db
      .select({
        runId: schema.productionConsumptions.runId,
        kg: sql<number>`sum(${schema.productionConsumptions.qtyActual})::float8`,
      })
      .from(schema.productionConsumptions)
      .where(inArray(schema.productionConsumptions.runId, runs))
      .groupBy(schema.productionConsumptions.runId),
    db
      .select({ id: r.id, date: r.date, runNumber: r.runNumber })
      .from(r)
      .where(and(gte(r.date, from), lt(r.date, addDays(to, 1)), sql`${r.status} <> 'cancelled'`))
      .orderBy(asc(r.date), asc(r.runNumber)),
  ]);
  const w = new Map(weighed.map((x) => [x.runId, x.kg]));
  const c = new Map(consumed.map((x) => [x.runId, x.kg]));
  const out: YieldPoint[] = [];
  for (const m of meta) {
    const weighedKg = w.get(m.id) ?? 0;
    const ingredientsKg = c.get(m.id) ?? 0;
    if (weighedKg <= 0 || ingredientsKg <= 0) continue; // sin consumos reales no se puede medir
    out.push({
      runId: m.id,
      date: m.date,
      runNumber: m.runNumber,
      weighedKg: roundQty(weighedKg),
      ingredientsKg: roundQty(ingredientsKg),
      yieldPct: roundTo(productionYield(weighedKg, ingredientsKg) * 100, 1),
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Entregas a tiempo y completas
// ------------------------------------------------------------------------------------------------

export interface OtifRow {
  promisedDate: IsoDate;
  deliveredDate: IsoDate;
  complete: boolean;
}

/**
 * Pedidos entregados con fecha de entrega (hora argentina) en [from, toExclusive): fecha comprometida,
 * fecha de entrega y si se despachó todo lo pedido. Sin remitos cargados se toma como completo.
 */
export async function getOtifRows(db: Executor, from: IsoDate, toExclusive: IsoDate): Promise<OtifRow[]> {
  const o = schema.orders;
  const deliveredDay = sql<string>`to_char((${o.deliveredAt} at time zone ${TZ})::date, 'YYYY-MM-DD')`;
  const delivered = await db
    .select({ id: o.id, promisedDate: o.promisedDate, deliveredDate: deliveredDay })
    .from(o)
    .where(
      and(
        inArray(o.status, ["delivered", "invoiced", "paid"]),
        sql`(${o.deliveredAt} at time zone ${TZ})::date >= ${from}::date`,
        sql`(${o.deliveredAt} at time zone ${TZ})::date < ${toExclusive}::date`,
      ),
    );
  if (delivered.length === 0) return [];
  const ids = delivered.map((d) => d.id);
  const [items, dispatched] = await Promise.all([
    db
      .select({
        orderId: schema.orderItems.orderId,
        productId: schema.orderItems.productId,
        qty: schema.orderItems.qtyUnits,
      })
      .from(schema.orderItems)
      .where(inArray(schema.orderItems.orderId, ids)),
    db
      .select({
        orderId: schema.dispatches.orderId,
        productId: schema.dispatchItems.productId,
        qty: sql<number>`sum(${schema.dispatchItems.qtyUnits})::int`,
      })
      .from(schema.dispatchItems)
      .innerJoin(schema.dispatches, eq(schema.dispatches.id, schema.dispatchItems.dispatchId))
      .where(
        and(
          inArray(schema.dispatches.orderId, ids),
          notInArray(schema.dispatches.status, ["cancelled", "rejected"]),
        ),
      )
      .groupBy(schema.dispatches.orderId, schema.dispatchItems.productId),
  ]);
  const dispatchedKey = new Map(dispatched.map((d) => [`${d.orderId}|${d.productId}`, d.qty]));
  const hasDispatch = new Set(dispatched.map((d) => d.orderId));
  const itemsByOrder = new Map<string, typeof items>();
  for (const i of items) itemsByOrder.set(i.orderId, [...(itemsByOrder.get(i.orderId) ?? []), i]);
  return delivered.map((d) => {
    const lines = (itemsByOrder.get(d.id) ?? []).map((i) => ({
      ordered: i.qty,
      dispatched: dispatchedKey.get(`${d.id}|${i.productId}`) ?? 0,
    }));
    return {
      promisedDate: d.promisedDate,
      deliveredDate: d.deliveredDate,
      complete: !hasDispatch.has(d.id) || deliveryIsComplete(lines),
    };
  });
}

/** Porcentaje a tiempo y completo de cada una de las últimas semanas (lunes a domingo), la actual al final. */
export async function getOtifByWeek(
  db: Executor,
  today: IsoDate,
  weeks = OTIF_CHART_WEEKS,
): Promise<OtifWeek[]> {
  const starts = lastWeekStarts(today, weeks);
  const rows = await getOtifRows(db, starts[0]!, addDays(today, 1));
  return starts.map((weekFrom) => {
    const mine = rows.filter((r) => weekStart(r.deliveredDate) === weekFrom);
    return {
      weekFrom,
      pct: onTimeInFullRate(mine),
      delivered: mine.length,
      ok: mine.filter((r) => r.deliveredDate <= r.promisedDate && r.complete).length,
    };
  });
}

// ------------------------------------------------------------------------------------------------
// Local, calidad y cobertura
// ------------------------------------------------------------------------------------------------

/** Unidades vendidas por día en el local (ventas no anuladas), `days` días terminando en `today`. */
export async function getStoreDailyUnits(
  db: Executor,
  today: IsoDate,
  days = DAILY_CHART_DAYS,
): Promise<DailyUnits[]> {
  const from = addDays(today, -(days - 1));
  const soldDay = sql<string>`to_char((${schema.storeSales.soldAt} at time zone ${TZ})::date, 'YYYY-MM-DD')`;
  const rows = await db
    .select({ date: soldDay, units: sql<number>`sum(${schema.storeSaleItems.qtyUnits})::int` })
    .from(schema.storeSaleItems)
    .innerJoin(schema.storeSales, eq(schema.storeSales.id, schema.storeSaleItems.saleId))
    .where(
      and(
        isNull(schema.storeSales.voidedAt),
        sql`(${schema.storeSales.soldAt} at time zone ${TZ})::date >= ${from}::date`,
        sql`(${schema.storeSales.soldAt} at time zone ${TZ})::date <= ${today}::date`,
      ),
    )
    .groupBy(sql`1`);
  const byDay = new Map(rows.map((r) => [r.date, r.units]));
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    return { date, units: byDay.get(date) ?? 0 };
  });
}

/** Registros de temperatura por día y cuántos quedaron fuera de rango, `days` días terminando en `today`. */
export async function getTemperaturesDaily(
  db: Executor,
  today: IsoDate,
  days = DAILY_CHART_DAYS,
): Promise<DailyTemperatures[]> {
  const from = addDays(today, -(days - 1));
  const t = schema.temperatureLogs;
  const rows = await db
    .select({
      date: t.date,
      readings: sql<number>`count(*)::int`,
      outOfRange: sql<number>`count(*) filter (where ${t.outOfRange})::int`,
    })
    .from(t)
    .where(and(gte(t.date, from), lte(t.date, today)))
    .groupBy(t.date);
  const byDay = new Map(rows.map((r) => [r.date, r]));
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    const r = byDay.get(date);
    return { date, readings: r?.readings ?? 0, outOfRange: r?.outOfRange ?? 0 };
  });
}

/**
 * Insumos con consumo (se puede calcular cuántos días rinde el stock), de menor a mayor cobertura, con el
 * punto de pedido expresado en días para marcarlo en el gráfico. Los sin consumo no tienen cobertura.
 */
export function coverageChart(coverage: IngredientCoverage[], limit = COVERAGE_CHART_ITEMS): CoveragePoint[] {
  return coverage
    .filter((c) => c.avgDailyConsumption > 0 || c.status === "out_of_stock")
    .map((c) => ({
      ingredientId: c.ingredientId,
      name: c.name,
      unit: c.unit,
      stock: c.stock,
      coverageDays: c.status === "out_of_stock" ? 0 : c.coverageDays,
      reorderDays: reorderPointDays(c.reorderPoint, c.avgDailyConsumption),
      status: c.status,
    }))
    .sort((a, b) => (a.coverageDays ?? Infinity) - (b.coverageDays ?? Infinity))
    .slice(0, limit);
}

// ------------------------------------------------------------------------------------------------
// Costo por bolsa mes a mes
// ------------------------------------------------------------------------------------------------

export interface CostPerBagPoint {
  month: string;
  /** Costo directo de la bolsa de 0,5 kg; null si algún insumo todavía no tenía precio de compra. */
  costPerBag: number | null;
  costPerKg: number | null;
}

/** Costo directo de la bolsa de 0,5 kg (la primera con costo completo). */
export function bagCostOf(costs: ProductCosts) {
  const p = costs.products.find((x) => x.netWeightKg === 0.5 && x.unitCost != null);
  return p?.unitCost != null ? { productName: p.name, cost: p.unitCost } : null;
}

/**
 * Costo por bolsa a fin de cada mes: se reconstruye con el precio de compra vigente a esa fecha (última compra
 * hasta el último día del mes, o hasta hoy en el mes en curso) y el rendimiento real de los 60 días previos.
 * La receta, el costo de la mano de obra y los componentes son los vigentes hoy: sólo cambian precios y rendimiento.
 */
export async function getCostPerBagByMonth(
  db: Executor,
  months: string[],
  today: IsoDate,
): Promise<CostPerBagPoint[]> {
  if (months.length === 0) return [];
  const ends = months.map((m) => monthSeriesEnd(m, today));
  const history = await db
    .select({
      ingredientId: schema.ingredientPrices.ingredientId,
      date: schema.ingredientPrices.date,
      unitPriceNet: schema.ingredientPrices.unitPriceNet,
    })
    .from(schema.ingredientPrices)
    .where(lte(schema.ingredientPrices.date, ends.at(-1)!))
    .orderBy(asc(schema.ingredientPrices.date), asc(schema.ingredientPrices.createdAt));
  const costs = await Promise.all(
    ends.map((end) => getProductCosts(db, end, { prices: pricesAsOf(history, end) })),
  );
  return costs.map((c, i) => ({
    month: months[i]!,
    costPerBag: bagCostOf(c)?.cost ?? null,
    costPerKg: c.costPerKg,
  }));
}
