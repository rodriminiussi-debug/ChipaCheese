import {
  DAILY_CAPACITY_KG,
  addDays,
  capacityUsagePct,
  deliveryIsComplete,
  isoWeekday,
  onTimeInFullRate,
  productionYield,
  roundMoney,
  roundQty,
  roundTo,
  workdaysBetween,
  type IsoDate,
} from "@chipa/domain";
import { and, desc, eq, gte, inArray, lt, ne, notInArray, schema, sql, type Executor } from "@chipa/db";
import { TZ, todayAR } from "@/lib/dates";
import {
  getChecksDueSoon,
  getReceivablesSummary,
  getSalesByChannel,
  monthBounds,
} from "@/features/billing/service";
import { getProductCosts, type ProductCosts } from "@/features/costing/service";
import { getDeliveryCostSummary } from "@/features/dispatch/service";
import { getMonthlyResult, type MonthlyResultDetail } from "@/features/finance/service";
import { getMaintenanceAlerts } from "@/features/maintenance/service";
import { countOverdueOrders, getOverdueCustomers } from "@/features/orders/service";
import { getPriceMatrix } from "@/features/pricing/service";
import { getQualityAlerts } from "@/features/quality/service";
import { getIngredientCoverage } from "@/features/stock/service";

/** Ventana (días) del rendimiento promedio del tablero. */
export const YIELD_WINDOW_DAYS = 30;
/** Días del gráfico de producción diaria. */
export const PRODUCTION_CHART_DAYS = 14;

// ------------------------------------------------------------------------------------------------
// Tipos
// ------------------------------------------------------------------------------------------------

export type AlertSeverity = "bad" | "warn";

/** Alerta accionable del tablero: qué pasa, cuántos y a dónde ir. */
export interface DashboardAlert {
  id: string;
  severity: AlertSeverity;
  label: string;
  /** Cantidad de elementos (pedidos, insumos, cheques…). */
  count: number;
  detail: string;
  href: string;
  /** Alertas con montos o márgenes: solo se arman para quien tiene `finance:read`. */
  financial: boolean;
}

export interface OperationalDashboard {
  today: IsoDate;
  month: string;
  capacity: {
    weekFrom: IsoDate;
    weekTo: IsoDate;
    workdays: number;
    producedKg: number;
    usagePct: number | null;
    capacityKg: number;
  };
  yield: { ratio: number | null; runs: number; weighedKg: number; windowDays: number };
  dailyProduction: { date: IsoDate; kg: number; workday: boolean }[];
  otif: { pct: number | null; delivered: number; ok: number; month: string };
  coverage: {
    total: number;
    belowReorderPoint: number;
    items: {
      ingredientId: string;
      name: string;
      coverageDays: number | null;
      status: string;
      unit: string;
    }[];
  };
  bpm: { cleaningCompliancePct: number | null; missingTemperaturesToday: number; outOfRangeLast24h: number };
  maintenance: {
    preventiveCompliancePct: number | null;
    overdue: number;
    dueSoon: number;
    openCorrectives: number;
  };
  orders: {
    overdue: number;
    customersToCall: { customerId: string; name: string; daysLate: number; daysSinceLastOrder: number }[];
  };
  lotsOnHold: number;
}

export interface FinancialDashboard {
  month: string;
  /** Resultado del mes y lo que cubre de los retiros. */
  result: Pick<MonthlyResultDetail, "result" | "resultPct" | "sales" | "withdrawals" | "hasData" | "notices">;
  costPerKg: number | null;
  /** Costo directo de la bolsa de 0,5 kg (la primera con costo completo). */
  costPerBag: { productName: string; cost: number } | null;
  missingPrices: string[];
  marginByChannel: {
    listId: string;
    listName: string;
    channel: string;
    targetMarginPct: number;
    /** Promedio de los productos con precio y costo. null si no hay ninguno. */
    avgMarginPct: number | null;
    worstMarginPct: number | null;
    belowCost: number;
    belowTarget: number;
  }[];
  belowCost: { listName: string; name: string; price: number; cost: number }[];
  salesByChannel: { channel: string; net: number; documents: number }[];
  salesNet: number;
  topCustomers: { customerId: string; name: string; net: number }[];
  receivables: { total: number; overdue: number };
  checksDueSoon: { count: number; amount: number };
  deliveryCostPerKg: number | null;
}

export interface Dashboard {
  today: IsoDate;
  month: string;
  operational: OperationalDashboard;
  /** null = el usuario no tiene `finance:read`: no se calcula ni se envía nada financiero. */
  financial: FinancialDashboard | null;
  alerts: DashboardAlert[];
}

// ------------------------------------------------------------------------------------------------
// Operativo
// ------------------------------------------------------------------------------------------------

async function readSettings(db: Executor) {
  const rows = await db
    .select()
    .from(schema.appSettings)
    .where(inArray(schema.appSettings.key, ["production.daily_capacity_kg", "production.workdays"]));
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const capacity = Number(m["production.daily_capacity_kg"]);
  const workdays = Array.isArray(m["production.workdays"])
    ? (m["production.workdays"] as unknown[]).map(Number).filter((n) => n >= 1 && n <= 7)
    : [];
  return {
    capacityKg: capacity > 0 ? capacity : DAILY_CAPACITY_KG,
    workdays: workdays.length > 0 ? workdays : [1, 2, 3, 4, 5],
  };
}

/** kg pesados por día de producción (producciones no canceladas). */
async function weighedKgByDay(db: Executor, from: IsoDate, to: IsoDate) {
  const rows = await db
    .select({
      date: schema.productionRuns.date,
      kg: sql<number>`sum(${schema.productionWeighings.kg})::float8`,
    })
    .from(schema.productionWeighings)
    .innerJoin(schema.productionRuns, eq(schema.productionRuns.id, schema.productionWeighings.runId))
    .where(
      and(
        gte(schema.productionRuns.date, from),
        lt(schema.productionRuns.date, addDays(to, 1)),
        ne(schema.productionRuns.status, "cancelled"),
      ),
    )
    .groupBy(schema.productionRuns.date);
  return new Map(rows.map((r) => [r.date, roundQty(r.kg)]));
}

/** Rendimiento (Regla 3) de las producciones de los últimos 30 días: kg pesados ÷ kg de ingredientes reales. */
async function averageYield(db: Executor, today: IsoDate) {
  const from = addDays(today, -YIELD_WINDOW_DAYS);
  const runs = db
    .select({ id: schema.productionRuns.id })
    .from(schema.productionRuns)
    .where(
      and(
        gte(schema.productionRuns.date, from),
        lt(schema.productionRuns.date, addDays(today, 1)),
        ne(schema.productionRuns.status, "cancelled"),
      ),
    );
  const [weighed, consumed] = await Promise.all([
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
  ]);
  const ingredients = new Map(consumed.map((c) => [c.runId, c.kg]));
  let weighedKg = 0;
  let ingredientsKg = 0;
  let n = 0;
  for (const w of weighed) {
    const used = ingredients.get(w.runId);
    if (!used || used <= 0 || w.kg <= 0) continue; // sin consumos reales no se puede medir
    weighedKg += w.kg;
    ingredientsKg += used;
    n++;
  }
  return {
    ratio: n > 0 ? productionYield(weighedKg, ingredientsKg) : null,
    runs: n,
    weighedKg: roundQty(weighedKg),
    windowDays: YIELD_WINDOW_DAYS,
  };
}

/**
 * Entregas a tiempo y completas del mes: pedidos entregados en el mes (fecha de entrega en hora argentina)
 * con entrega ≤ fecha comprometida y con todo lo pedido despachado. Si el pedido no tiene remitos cargados
 * no se puede saber lo despachado y se lo toma como completo.
 */
export async function getOtif(db: Executor, month: string) {
  const { from, to } = monthBounds(month);
  const o = schema.orders;
  const deliveredDay = sql<string>`to_char((${o.deliveredAt} at time zone ${TZ})::date, 'YYYY-MM-DD')`;
  const delivered = await db
    .select({ id: o.id, promisedDate: o.promisedDate, deliveredDate: deliveredDay })
    .from(o)
    .where(
      and(
        inArray(o.status, ["delivered", "invoiced", "paid"]),
        sql`(${o.deliveredAt} at time zone ${TZ})::date >= ${from}::date`,
        sql`(${o.deliveredAt} at time zone ${TZ})::date < ${to}::date`,
      ),
    );
  if (delivered.length === 0) return { pct: null, delivered: 0, ok: 0, month };
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
  const rows = delivered.map((d) => {
    const lines = items
      .filter((i) => i.orderId === d.id)
      .map((i) => ({ ordered: i.qty, dispatched: dispatchedKey.get(`${d.id}|${i.productId}`) ?? 0 }));
    return {
      promisedDate: d.promisedDate,
      deliveredDate: d.deliveredDate,
      complete: !hasDispatch.has(d.id) || deliveryIsComplete(lines),
    };
  });
  const pct = onTimeInFullRate(rows);
  const ok = rows.filter((r) => r.deliveredDate <= r.promisedDate && r.complete).length;
  return { pct, delivered: rows.length, ok, month };
}

/** Lunes de la semana de `date`. */
function mondayOf(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoWeekday(date));
}

export async function getOperationalDashboard(
  db: Executor,
  opts: { today?: IsoDate; month?: string } = {},
): Promise<OperationalDashboard> {
  const today = opts.today ?? todayAR();
  const month = opts.month ?? today.slice(0, 7);
  const chartFrom = addDays(today, -(PRODUCTION_CHART_DAYS - 1));
  const weekFrom = mondayOf(today);
  const [settings, byDay, yieldAvg, otif, coverage, quality, maintenance, overdueOrders, toCall] =
    await Promise.all([
      readSettings(db),
      weighedKgByDay(db, weekFrom < chartFrom ? weekFrom : chartFrom, today),
      averageYield(db, today),
      getOtif(db, month),
      getIngredientCoverage(db, { today }),
      getQualityAlerts(db, today),
      getMaintenanceAlerts(db, today),
      countOverdueOrders(db, today),
      getOverdueCustomers(db, today),
    ]);

  // Semana en curso (lunes a hoy): kg ÷ (150 × días hábiles transcurridos). Si hoy es fin de semana cuenta la semana completa.
  const weekTo = today;
  const workdays = workdaysBetween(weekFrom, weekTo, settings.workdays);
  let producedKg = 0;
  for (let d = weekFrom; d <= weekTo; d = addDays(d, 1)) producedKg += byDay.get(d) ?? 0;
  producedKg = roundQty(producedKg);

  const dailyProduction = Array.from({ length: PRODUCTION_CHART_DAYS }, (_, i) => {
    const date = addDays(chartFrom, i);
    return { date, kg: byDay.get(date) ?? 0, workday: settings.workdays.includes(isoWeekday(date)) };
  });

  const below = coverage.filter((c) => c.status === "reorder" || c.status === "out_of_stock");
  return {
    today,
    month,
    capacity: {
      weekFrom,
      weekTo,
      workdays,
      producedKg,
      usagePct: capacityUsagePct(producedKg, workdays, settings.capacityKg),
      capacityKg: settings.capacityKg,
    },
    yield: yieldAvg,
    dailyProduction,
    otif,
    coverage: {
      total: coverage.length,
      belowReorderPoint: below.length,
      items: below.slice(0, 6).map((c) => ({
        ingredientId: c.ingredientId,
        name: c.name,
        coverageDays: c.coverageDays,
        status: c.status,
        unit: c.unit,
      })),
    },
    bpm: {
      cleaningCompliancePct: quality.cleaningComplianceMonthPct,
      missingTemperaturesToday: quality.missingTemperaturesToday,
      outOfRangeLast24h: quality.outOfRangeLast24h,
    },
    maintenance,
    orders: {
      overdue: overdueOrders,
      customersToCall: toCall.slice(0, 5).map((c) => ({
        customerId: c.customerId,
        name: c.name,
        daysLate: c.daysLate,
        daysSinceLastOrder: c.daysSinceLastOrder,
      })),
    },
    lotsOnHold: quality.lotsOnHold,
  };
}

// ------------------------------------------------------------------------------------------------
// Financiero
// ------------------------------------------------------------------------------------------------

/** Clientes con más ventas netas facturadas en el mes (las notas de crédito restan). */
export async function getTopCustomers(db: Executor, month: string, limit = 5) {
  const { from, to } = monthBounds(month);
  const si = schema.salesInvoices;
  const signed = sql<number>`sum(case when ${si.invoiceType} in ('NC_A','NC_B','NC_C') then -${si.netTotal} else ${si.netTotal} end)::float8`;
  const rows = await db
    .select({ customerId: si.customerId, name: schema.customers.legalName, net: signed })
    .from(si)
    .innerJoin(schema.customers, eq(schema.customers.id, si.customerId))
    .where(and(ne(si.status, "voided"), gte(si.issueDate, from), lt(si.issueDate, to)))
    .groupBy(si.customerId, schema.customers.legalName)
    .orderBy(desc(signed))
    .limit(limit);
  return rows.map((r) => ({ ...r, net: roundMoney(r.net) }));
}

function bagCost(costs: ProductCosts) {
  const p = costs.products.find((x) => x.netWeightKg === 0.5 && x.unitCost != null);
  return p?.unitCost != null ? { productName: p.name, cost: p.unitCost } : null;
}

export async function getFinancialDashboard(
  db: Executor,
  opts: { today?: IsoDate; month?: string; costs?: ProductCosts } = {},
): Promise<FinancialDashboard> {
  const today = opts.today ?? todayAR();
  const month = opts.month ?? today.slice(0, 7);
  const costs = opts.costs ?? (await getProductCosts(db, today));
  const [result, matrix, sales, topCustomers, receivables, checks, delivery] = await Promise.all([
    getMonthlyResult(db, month, { today, costs }),
    getPriceMatrix(db, today, costs),
    getSalesByChannel(db, month),
    getTopCustomers(db, month),
    getReceivablesSummary(db, today),
    getChecksDueSoon(db, today, 7),
    getDeliveryCostSummary(db, month),
  ]);

  const marginByChannel = matrix.lists.map((l) => {
    const margins = l.rows.map((r) => r.marginPct).filter((m): m is number => m != null);
    return {
      listId: l.id,
      listName: l.name,
      channel: l.channel,
      targetMarginPct: l.targetMarginPct,
      avgMarginPct: margins.length ? roundTo(margins.reduce((a, b) => a + b, 0) / margins.length, 1) : null,
      worstMarginPct: margins.length ? Math.min(...margins) : null,
      belowCost: l.belowCost,
      belowTarget: l.belowTarget,
    };
  });
  const belowCost = matrix.lists.flatMap((l) =>
    l.rows
      .filter((r) => r.status === "below_cost")
      .map((r) => ({ listName: l.name, name: r.name, price: r.price!, cost: r.cost! })),
  );

  return {
    month,
    result: {
      result: result.result,
      resultPct: result.resultPct,
      sales: result.sales,
      withdrawals: result.withdrawals,
      hasData: result.hasData,
      notices: result.notices,
    },
    costPerKg: costs.costPerKg,
    costPerBag: bagCost(costs),
    missingPrices: [...new Set(costs.products.flatMap((p) => p.missingPrices))],
    marginByChannel,
    belowCost,
    salesByChannel: Object.entries(sales.byChannel)
      .map(([channel, v]) => ({ channel, net: v.net, documents: v.documents }))
      .sort((a, b) => b.net - a.net),
    salesNet: sales.net,
    topCustomers,
    receivables: { total: receivables.total, overdue: receivables.overdue },
    checksDueSoon: {
      count: checks.length,
      amount: roundMoney(checks.reduce((a, c) => a + c.amount, 0)),
    },
    deliveryCostPerKg: delivery.costPerKg,
  };
}

// ------------------------------------------------------------------------------------------------
// Alertas accionables
// ------------------------------------------------------------------------------------------------

export function buildAlerts(op: OperationalDashboard, fin: FinancialDashboard | null): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];
  const add = (a: Omit<DashboardAlert, "financial"> & { financial?: boolean }) =>
    a.count > 0 && alerts.push({ financial: false, ...a });

  add({
    id: "overdue-orders",
    severity: "bad",
    label: "Pedidos atrasados",
    count: op.orders.overdue,
    detail: "Pasó la fecha comprometida y todavía no se entregaron.",
    href: "/pedidos?atrasados=1",
  });
  add({
    id: "customers-to-call",
    severity: "warn",
    label: "Clientes para llamar",
    count: op.orders.customersToCall.length,
    detail: op.orders.customersToCall.map((c) => c.name).join(", "),
    href: "/pedidos",
  });
  add({
    id: "reorder",
    severity: "warn",
    label: "Insumos a reponer",
    count: op.coverage.belowReorderPoint,
    detail: op.coverage.items.map((i) => i.name).join(", "),
    href: "/stock",
  });
  add({
    id: "temperature",
    severity: "bad",
    label: "Temperaturas fuera de rango",
    count: op.bpm.outOfRangeLast24h,
    detail: "Lecturas de hoy y ayer fuera del rango del equipo.",
    href: "/calidad?vista=temperaturas",
  });
  add({
    id: "temperature-missing",
    severity: "warn",
    label: "Temperaturas sin registrar hoy",
    count: op.bpm.missingTemperaturesToday,
    detail: "Equipos que todavía no tienen lectura de temperatura hoy.",
    href: "/calidad?vista=temperaturas",
  });
  add({
    id: "held-lots",
    severity: "bad",
    label: "Lotes retenidos",
    count: op.lotsOnHold,
    detail: "Lotes de producto terminado bloqueados por un reclamo o control.",
    href: "/calidad",
  });
  add({
    id: "maintenance",
    severity: "bad",
    label: "Mantenimiento vencido",
    count: op.maintenance.overdue,
    detail: "Preventivos que pasaron su fecha.",
    href: "/mantenimiento",
  });

  add({
    id: "corrective",
    severity: "warn",
    label: "Correctivos de mantenimiento abiertos",
    count: op.maintenance.openCorrectives,
    detail: "Órdenes de reparación todavía sin cerrar.",
    href: "/mantenimiento?vista=correctivos&estado=open",
  });

  if (fin) {
    add({
      id: "checks",
      severity: "warn",
      label: "Cheques a cobrar en 7 días",
      count: fin.checksDueSoon.count,
      detail: "Cheques en cartera que se pueden cobrar esta semana.",
      href: "/cobranzas/cheques",
      financial: true,
    });
    add({
      id: "below-cost",
      severity: "bad",
      label: "Precios bajo costo",
      count: fin.belowCost.length,
      detail: fin.belowCost.map((b) => `${b.name} (${b.listName})`).join(", "),
      href: "/precios",
      financial: true,
    });
    add({
      id: "receivables-overdue",
      severity: "warn",
      label: "Deuda vencida de clientes",
      count: fin.receivables.overdue > 0 ? 1 : 0,
      detail: "Clientes con facturas vencidas sin cobrar.",
      href: "/cobranzas",
      financial: true,
    });
    add({
      id: "missing-prices",
      severity: "warn",
      label: "Faltan precios de compra",
      count: fin.missingPrices.length,
      detail: fin.missingPrices.join(", "),
      href: "/costos",
      financial: true,
    });
  }
  // Severidad primero, luego orden de armado.
  return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "bad" ? -1 : 1));
}

/**
 * Tablero (RF-41). Las consultas corren en paralelo. `includeFinance=false` (quien tiene `dashboard:read`
 * pero no `finance:read`) no ejecuta ni devuelve nada financiero: ni resultado, ni márgenes, ni deuda, ni precios.
 */
export async function getDashboard(
  db: Executor,
  opts: { today?: IsoDate; month?: string; includeFinance: boolean },
): Promise<Dashboard> {
  const today = opts.today ?? todayAR();
  const month = opts.month ?? today.slice(0, 7);
  const [operational, financial] = await Promise.all([
    getOperationalDashboard(db, { today, month }),
    opts.includeFinance ? getFinancialDashboard(db, { today, month }) : Promise.resolve(null),
  ]);
  return { today, month, operational, financial, alerts: buildAlerts(operational, financial) };
}
