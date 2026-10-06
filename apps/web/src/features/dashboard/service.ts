import { getPendingReplenishments } from "@/features/store/replenishment";
import { getStoreStockAlerts } from "@/features/store/alerts";
import {
  DAILY_CAPACITY_KG,
  addDays,
  capacityUsagePct,
  isoWeekday,
  monthsBack,
  onTimeInFullRate,
  productionYield,
  roundMoney,
  roundQty,
  formatNumber,
  roundTo,
  workdaysBetween,
  type IsoDate,
} from "@chipa/domain";
import { and, desc, eq, gte, inArray, lt, ne, schema, sql, type Executor } from "@chipa/db";
import { todayAR } from "@/lib/dates";
import { getChecksDueSoon, getReceivablesSummary, monthBounds } from "@/features/billing/service";
import { getProductCosts, type ProductCosts } from "@/features/costing/service";
import { costByZone, type ZoneCostRow } from "@/features/dispatch/service";
import {
  getMonthlyResult,
  getPartnerWithdrawals,
  type MonthlyResultDetail,
} from "@/features/finance/service";
import { getMaintenanceAlerts } from "@/features/maintenance/service";
import { countOverdueOrders, getOverdueCustomers } from "@/features/orders/service";
import { getPriceMatrix } from "@/features/pricing/service";
import { getQualityAlerts } from "@/features/quality/service";
import { getIngredientCoverage } from "@/features/stock/service";
import {
  FINISHED_EXPIRY_DAYS,
  PRICE_INCREASE_PCT,
  RAW_EXPIRY_DAYS,
  getExpiryAlerts,
  getLateSupplierOrders,
  getNextDayOrders,
  getPriceIncreases,
  type AlertThresholds,
  type ExpiryAlerts,
  type LateSupplierOrders,
  type NextDayOrders,
  type PriceIncreaseAlert,
} from "./attention";
import {
  DAILY_CHART_DAYS,
  OTIF_CHART_WEEKS,
  YIELD_CHART_DAYS,
  bagCostOf,
  coverageChart,
  getCostPerBagByMonth,
  getOtifByWeek,
  getOtifRows,
  getStoreDailyUnits,
  getTemperaturesDaily,
  getYieldByRun,
  type CostPerBagPoint,
  type OperationalCharts,
} from "./series";

export type { AlertThresholds, ExpiryAlerts, LateSupplierOrders, NextDayOrders, PriceIncreaseAlert };
export type { CostPerBagPoint, OperationalCharts };

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
  /** Lotes con saldo por vencer (producto terminado ≤ 30 días, materia prima ≤ 7 días). */
  expiry: ExpiryAlerts;
  lateSupplierOrders: LateSupplierOrders;
  nextDayOrders: NextDayOrders;
  /** Series de los gráficos operativos: sin montos. */
  charts: OperationalCharts;
}

/** Gráficos con plata: sólo existen para quien tiene `finance:read`. */
export interface FinancialCharts {
  /** Los últimos 6 meses, el último es el mes elegido. */
  months: string[];
  salesByMonth: { month: string; total: number; byChannel: Record<string, number> }[];
  resultByMonth: {
    month: string;
    result: number;
    resultPct: number | null;
    sales: number;
    hasData: boolean;
  }[];
  /** Retiros mensuales de los socios (referencia del gráfico de resultado). */
  withdrawals: number;
  costPerBagByMonth: CostPerBagPoint[];
  deliveryByMonth: { month: string; costPerKg: number | null; kg: number; cost: number; routes: number }[];
  deliveryByZone: ZoneCostRow[];
  /** Deuda de clientes por antigüedad a hoy. */
  receivablesAging: {
    current: number;
    d1_30: number;
    d31_60: number;
    d61_90: number;
    d90_plus: number;
    total: number;
  };
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
  charts: FinancialCharts;
}

export interface Dashboard {
  today: IsoDate;
  month: string;
  operational: OperationalDashboard;
  /** null = el usuario no tiene `finance:read`: no se calcula ni se envía nada financiero. */
  financial: FinancialDashboard | null;
  /** Aumentos de precio de compra (porcentajes): para quien ve finanzas o compras. null = sin permiso. */
  priceIncreases: PriceIncreaseAlert[] | null;
  alerts: DashboardAlert[];
}

// ------------------------------------------------------------------------------------------------
// Operativo
// ------------------------------------------------------------------------------------------------

async function readSettings(db: Executor) {
  const rows = await db
    .select()
    .from(schema.appSettings)
    .where(
      inArray(schema.appSettings.key, [
        "production.daily_capacity_kg",
        "production.workdays",
        "alerts.finished_expiry_days",
        "alerts.raw_expiry_days",
        "alerts.price_increase_pct",
      ]),
    );
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const capacity = Number(m["production.daily_capacity_kg"]);
  const workdays = Array.isArray(m["production.workdays"])
    ? (m["production.workdays"] as unknown[]).map(Number).filter((n) => n >= 1 && n <= 7)
    : [];
  const positive = (key: string, fallback: number) => {
    const n = Number(m[key]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    capacityKg: capacity > 0 ? capacity : DAILY_CAPACITY_KG,
    workdays: workdays.length > 0 ? workdays : [1, 2, 3, 4, 5],
    thresholds: {
      finishedExpiryDays: positive("alerts.finished_expiry_days", FINISHED_EXPIRY_DAYS),
      rawExpiryDays: positive("alerts.raw_expiry_days", RAW_EXPIRY_DAYS),
      priceIncreasePct: positive("alerts.price_increase_pct", PRICE_INCREASE_PCT),
    } satisfies AlertThresholds,
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

/** Rendimiento (Regla 3) promedio de las producciones de los últimos 30 días: kg pesados ÷ kg de ingredientes reales. */
function averageYield(points: { date: IsoDate; weighedKg: number; ingredientsKg: number }[], today: IsoDate) {
  const from = addDays(today, -YIELD_WINDOW_DAYS);
  const inWindow = points.filter((p) => p.date >= from);
  const weighedKg = inWindow.reduce((a, p) => a + p.weighedKg, 0);
  const ingredientsKg = inWindow.reduce((a, p) => a + p.ingredientsKg, 0);
  return {
    ratio: inWindow.length > 0 ? productionYield(weighedKg, ingredientsKg) : null,
    runs: inWindow.length,
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
  const rows = await getOtifRows(db, from, to);
  if (rows.length === 0) return { pct: null, delivered: 0, ok: 0, month };
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
  const settings = await readSettings(db);
  const [
    byDay,
    yieldRuns,
    otif,
    otifByWeek,
    coverage,
    quality,
    maintenance,
    overdueOrders,
    toCall,
    storeDaily,
    temperaturesDaily,
    expiry,
    lateSupplierOrders,
    nextDayOrders,
  ] = await Promise.all([
    weighedKgByDay(db, weekFrom < chartFrom ? weekFrom : chartFrom, today),
    getYieldByRun(db, addDays(today, -(YIELD_CHART_DAYS - 1)), today),
    getOtif(db, month),
    getOtifByWeek(db, today, OTIF_CHART_WEEKS),
    getIngredientCoverage(db, { today }),
    getQualityAlerts(db, today),
    getMaintenanceAlerts(db, today),
    countOverdueOrders(db, today),
    getOverdueCustomers(db, today),
    getStoreDailyUnits(db, today, DAILY_CHART_DAYS),
    getTemperaturesDaily(db, today, DAILY_CHART_DAYS),
    getExpiryAlerts(db, today, {
      finishedDays: settings.thresholds.finishedExpiryDays,
      rawDays: settings.thresholds.rawExpiryDays,
    }),
    getLateSupplierOrders(db, today),
    getNextDayOrders(db, today, settings.workdays),
  ]);
  const yieldAvg = averageYield(yieldRuns, today);

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
    expiry,
    lateSupplierOrders,
    nextDayOrders,
    charts: {
      yieldByRun: yieldRuns,
      coverage: coverageChart(coverage),
      otifByWeek,
      storeDaily,
      temperaturesDaily,
    },
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

/** Meses que muestran los gráficos de evolución. */
export const HISTORY_MONTHS = 6;
/** Clientes del gráfico "quiénes compran más". */
export const TOP_CUSTOMERS = 10;

export async function getFinancialDashboard(
  db: Executor,
  opts: { today?: IsoDate; month?: string; costs?: ProductCosts } = {},
): Promise<FinancialDashboard> {
  const today = opts.today ?? todayAR();
  const month = opts.month ?? today.slice(0, 7);
  const months = monthsBack(month, HISTORY_MONTHS);
  const costs = opts.costs ?? (await getProductCosts(db, today));
  // Un resultado por cada uno de los 6 meses (mismas cuentas que /costos/resultado): de ahí salen también
  // las ventas por canal de cada mes, el reparto y el resultado del mes elegido.
  const history = getPartnerWithdrawals(db).then(async (withdrawals) => ({
    withdrawals,
    results: await Promise.all(months.map((m) => getMonthlyResult(db, m, { today, costs, withdrawals }))),
  }));
  const [{ withdrawals, results }, matrix, topCustomers, receivables, checks, zones, bagSeries] =
    await Promise.all([
      history,
      getPriceMatrix(db, today, costs),
      getTopCustomers(db, month, TOP_CUSTOMERS),
      getReceivablesSummary(db, today),
      getChecksDueSoon(db, today, 7),
      costByZone(db, month),
      getCostPerBagByMonth(db, months, today),
    ]);
  const result = results.at(-1)!;

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
    costPerBag: (() => {
      const b = bagCostOf(costs);
      return b ? { productName: b.productName, cost: b.cost } : null;
    })(),
    missingPrices: [...new Set(costs.products.flatMap((p) => p.missingPrices))],
    marginByChannel,
    belowCost,
    salesByChannel: result.salesByChannel
      .map((c) => ({ channel: c.channel, net: c.net, documents: c.documents }))
      .sort((a, b) => b.net - a.net),
    salesNet: result.sales,
    topCustomers,
    receivables: { total: receivables.total, overdue: receivables.overdue },
    checksDueSoon: {
      count: checks.length,
      amount: roundMoney(checks.reduce((a, c) => a + c.amount, 0)),
    },
    deliveryCostPerKg: result.delivery.costPerKg,
    charts: {
      months,
      salesByMonth: results.map((r) => ({
        month: r.month,
        total: r.sales,
        byChannel: Object.fromEntries(r.salesByChannel.map((c) => [c.channel, c.net])),
      })),
      resultByMonth: results.map((r) => ({
        month: r.month,
        result: r.result,
        resultPct: r.resultPct,
        sales: r.sales,
        hasData: r.hasData,
      })),
      withdrawals: withdrawals.amount,
      costPerBagByMonth: bagSeries,
      deliveryByMonth: results.map((r) => ({
        month: r.month,
        costPerKg: r.delivery.costPerKg,
        kg: r.delivery.kg,
        cost: r.delivery.cost,
        routes: r.delivery.routes,
      })),
      deliveryByZone: zones.zones,
      receivablesAging: receivables.buckets,
    },
  };
}

// ------------------------------------------------------------------------------------------------
// Alertas accionables
// ------------------------------------------------------------------------------------------------

/** "lunes" para la fecha de negocio (sin corrimientos de huso). */
function weekdayName(date: IsoDate) {
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

const lotLine = (i: { name: string; lot: string; daysLeft: number }) =>
  `${i.name}${i.lot ? ` (lote ${i.lot})` : ""}: ${i.daysLeft < 0 ? "vencido" : `${i.daysLeft} día(s)`}`;

/**
 * Alertas accionables. `extra.priceIncreases` (null/ausente = sin permiso de compras o finanzas) y `extra.store`
 * (alertas del local, ver `getStoreAlerts`) las arma `getDashboard` según quién mira.
 */
export function buildAlerts(
  op: OperationalDashboard,
  fin: FinancialDashboard | null,
  extra: { priceIncreases?: PriceIncreaseAlert[] | null; store?: DashboardAlert[] } = {},
): DashboardAlert[] {
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

  add({
    id: "tomorrow-orders",
    severity: "warn",
    label: op.nextDayOrders.isTomorrow
      ? "Pedidos de mañana sin preparar"
      : `Pedidos del ${weekdayName(op.nextDayOrders.date)} sin preparar`,
    count: op.nextDayOrders.notReady + op.nextDayOrders.readyWithoutRoute,
    detail: [
      op.nextDayOrders.notReady > 0 ? `${op.nextDayOrders.notReady} sin terminar` : null,
      op.nextDayOrders.readyWithoutRoute > 0
        ? `${op.nextDayOrders.readyWithoutRoute} listo(s) sin ruta`
        : null,
      ...op.nextDayOrders.items.map((i) => i.customer),
    ]
      .filter(Boolean)
      .join(" · "),
    // Si lo que falta es armar la ruta se resuelve en despacho; si faltan pedidos por terminar, en pedidos.
    href: op.nextDayOrders.notReady > 0 ? "/pedidos" : "/despacho/nueva",
  });
  add({
    id: "late-suppliers",
    severity: "warn",
    label: "Entregas de proveedores atrasadas",
    count: op.lateSupplierOrders.count,
    detail: op.lateSupplierOrders.items.map((i) => `${i.supplier} (${i.daysLate} día(s))`).join(", "),
    href: "/compras/ordenes",
  });
  add({
    id: "finished-expiry",
    severity: op.expiry.finished.expired > 0 ? "bad" : "warn",
    label: "Lotes de producto terminado por vencer",
    count: op.expiry.finished.count,
    detail: `Vencen en ${op.expiry.finished.thresholdDays} días o menos: ${op.expiry.finished.items.map(lotLine).join(", ")}`,
    href: "/stock/producto-terminado",
  });
  add({
    id: "raw-expiry",
    severity: op.expiry.raw.expired > 0 ? "bad" : "warn",
    label: "Lotes de materia prima por vencer",
    count: op.expiry.raw.count,
    detail: `Vencen en ${op.expiry.raw.thresholdDays} días o menos: ${op.expiry.raw.items.map(lotLine).join(", ")}`,
    href: "/stock",
  });
  const increases = extra.priceIncreases ?? [];
  add({
    id: "price-increases",
    severity: "warn",
    label: "Aumentos de precio de compra",
    count: increases.length,
    detail: increases.map((i) => `${i.name} +${formatNumber(i.pct, 1)} %`).join(", "),
    href: increases.length === 1 ? `/compras/precios/${increases[0]!.ingredientId}` : "/compras/precios",
  });
  for (const a of extra.store ?? []) add(a);

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

/** Alertas del local: productos por agotarse según la demanda y reposiciones que la planta debe enviar. */
async function getStoreAlerts(db: Executor, today: IsoDate): Promise<DashboardAlert[]> {
  const [stock, pending] = await Promise.all([
    getStoreStockAlerts(db, today),
    getPendingReplenishments(db, today),
  ]);
  const alerts: DashboardAlert[] = [];
  const toReorder = stock.rows.filter((r) => r.status === "out" || r.status === "reorder");
  if (toReorder.length) {
    const out = toReorder.filter((r) => r.status === "out").length;
    alerts.push({
      id: "store-stock",
      severity: out > 0 ? "bad" : "warn",
      label: "Stock del local por agotarse",
      count: toReorder.length,
      detail: `${toReorder
        .slice(0, 3)
        .map((r) => r.name)
        .join(", ")}${toReorder.length > 3 ? "…" : ""}${out ? ` · ${out} agotado(s)` : ""}`,
      href: "/local",
      financial: false,
    });
  }
  if (pending.length) {
    const late = pending.filter((p) => p.overdue).length;
    alerts.push({
      id: "store-replenishment",
      severity: late > 0 ? "bad" : "warn",
      label: "Reposiciones del local por enviar",
      count: pending.length,
      detail: `${pending.reduce((a, p) => a + p.totalUnits, 0)} unidades pedidas${late ? ` · ${late} vencida(s)` : ""}`,
      href: "/stock/reposicion",
      financial: false,
    });
  }
  return alerts;
}

/**
 * Tablero (RF-41). Las consultas corren en paralelo. `includeFinance=false` (quien tiene `dashboard:read`
 * pero no `finance:read`) no ejecuta ni devuelve nada financiero: ni resultado, ni márgenes, ni deuda, ni precios,
 * ni los gráficos con montos. `includePrices` (finanzas o compras) suma el aviso de aumentos de precio de compra,
 * que sólo lleva porcentajes; por defecto sigue a `includeFinance`.
 */
export async function getDashboard(
  db: Executor,
  opts: { today?: IsoDate; month?: string; includeFinance: boolean; includePrices?: boolean },
): Promise<Dashboard> {
  const today = opts.today ?? todayAR();
  const month = opts.month ?? today.slice(0, 7);
  const includePrices = opts.includePrices ?? opts.includeFinance;
  const settings = await readSettings(db);
  const [operational, financial, priceIncreases, store] = await Promise.all([
    getOperationalDashboard(db, { today, month }),
    opts.includeFinance ? getFinancialDashboard(db, { today, month }) : Promise.resolve(null),
    includePrices
      ? getPriceIncreases(db, today, settings.thresholds.priceIncreasePct)
      : Promise.resolve(null),
    getStoreAlerts(db, today),
  ]);
  return {
    today,
    month,
    operational,
    financial,
    priceIncreases,
    alerts: buildAlerts(operational, financial, { priceIncreases, store }),
  };
}
