import {
  addDays,
  addMonths,
  monthlyResult,
  monthsBack,
  roundMoney,
  withdrawalsCoverage,
  type IsoDate,
} from "@chipa/domain";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  schema,
  sql,
  type Executor,
} from "@chipa/db";
import { TZ, todayAR } from "@/lib/dates";
import { UserError } from "@/server/errors";
import { getProductCosts, type ProductCosts } from "@/features/costing/service";
import { getSalesByChannel, monthBounds } from "@/features/billing/service";
import { getDeliveryCostSummary, type DeliveryCostSummary } from "@/features/dispatch/service";
import { getPriceMatrix } from "@/features/pricing/service";
import {
  DEFAULT_WITHDRAWALS,
  EXCEL_MISSING_CATEGORIES,
  EXPENSE_CATEGORY,
  isCheese,
  SETTING_WITHDRAWALS,
  type ExpenseCategory,
} from "./labels";
import type { FixedExpenseData, UpdateFixedExpenseData } from "./schemas";

/** Rinde de ingredientes que el Excel de costos usaba como "kg de producto" (relevamiento, error 1). */
export const EXCEL_YIELD_KG = 163.5;

const firstOfMonth = (month: string): IsoDate => `${month}-01`;

function assertMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new UserError("Mes inválido (usá AAAA-MM).");
}

// ------------------------------------------------------------------------------------------------
// RF-42: gastos fijos y servicios del mes
// ------------------------------------------------------------------------------------------------

export interface FixedExpenseRow {
  id: string;
  concept: string;
  category: string;
  amount: number;
  notes: string | null;
}

export interface FixedExpenses {
  month: string;
  rows: FixedExpenseRow[];
  total: number;
  byCategory: { category: string; label: string; amount: number }[];
  /** Categorías que el Excel no tenía y que no tienen ningún gasto cargado en el mes. */
  missingCategories: { category: ExpenseCategory; label: string; hint: string }[];
}

export async function listFixedExpenses(db: Executor, month: string): Promise<FixedExpenses> {
  assertMonth(month);
  const rows = await db
    .select({
      id: schema.fixedExpenses.id,
      concept: schema.fixedExpenses.concept,
      category: schema.fixedExpenses.category,
      amount: schema.fixedExpenses.amount,
      notes: schema.fixedExpenses.notes,
    })
    .from(schema.fixedExpenses)
    .where(eq(schema.fixedExpenses.month, firstOfMonth(month)))
    .orderBy(asc(schema.fixedExpenses.category), asc(schema.fixedExpenses.concept));
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.category, roundMoney((totals.get(r.category) ?? 0) + r.amount));
  const present = new Set(rows.map((r) => r.category));
  return {
    month,
    rows,
    total: roundMoney(rows.reduce((a, r) => a + r.amount, 0)),
    byCategory: [...totals.entries()].map(([category, amount]) => ({
      category,
      label: EXPENSE_CATEGORY[category] ?? category,
      amount,
    })),
    missingCategories: EXCEL_MISSING_CATEGORIES.filter((m) => !present.has(m.category)).map((m) => ({
      ...m,
      label: EXPENSE_CATEGORY[m.category] ?? m.category,
    })),
  };
}

async function assertConceptFree(db: Executor, month: IsoDate, concept: string, exceptId?: string) {
  const [dup] = await db
    .select({ id: schema.fixedExpenses.id })
    .from(schema.fixedExpenses)
    .where(
      and(
        eq(schema.fixedExpenses.month, month),
        sql`lower(${schema.fixedExpenses.concept}) = lower(${concept})`,
        exceptId ? ne(schema.fixedExpenses.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (dup)
    throw new UserError(`Ya hay un gasto "${concept}" en ese mes.`, { concept: ["Ya existe en el mes"] });
}

export async function createFixedExpense(db: Executor, input: FixedExpenseData) {
  const month = firstOfMonth(input.month);
  await assertConceptFree(db, month, input.concept);
  const [row] = await db
    .insert(schema.fixedExpenses)
    .values({
      month,
      concept: input.concept,
      category: input.category,
      amount: input.amount,
      notes: input.notes,
    })
    .returning();
  return row!;
}

export async function updateFixedExpense(db: Executor, input: UpdateFixedExpenseData) {
  const current = await db.query.fixedExpenses.findFirst({
    where: eq(schema.fixedExpenses.id, input.id),
  });
  if (!current) throw new UserError("El gasto no existe.");
  await assertConceptFree(db, current.month, input.concept, input.id);
  const [row] = await db
    .update(schema.fixedExpenses)
    .set({ concept: input.concept, category: input.category, amount: input.amount, notes: input.notes })
    .where(eq(schema.fixedExpenses.id, input.id))
    .returning();
  return row!;
}

export async function deleteFixedExpense(db: Executor, id: string) {
  const deleted = await db.delete(schema.fixedExpenses).where(eq(schema.fixedExpenses.id, id)).returning();
  if (deleted.length === 0) throw new UserError("El gasto no existe.");
}

/**
 * "Copiar del mes anterior": trae al mes los conceptos del mes anterior que todavía no están cargados
 * (no pisa los que ya existen). Falla si el mes anterior no tiene nada.
 */
export async function copyFixedExpensesFromPreviousMonth(db: Executor, month: string) {
  assertMonth(month);
  const target = firstOfMonth(month);
  const previous = addMonths(target, -1);
  const [prevRows, current] = await Promise.all([
    db.select().from(schema.fixedExpenses).where(eq(schema.fixedExpenses.month, previous)),
    db
      .select({ concept: schema.fixedExpenses.concept })
      .from(schema.fixedExpenses)
      .where(eq(schema.fixedExpenses.month, target)),
  ]);
  if (prevRows.length === 0) throw new UserError("El mes anterior no tiene gastos cargados para copiar.");
  const existing = new Set(current.map((c) => c.concept.toLowerCase()));
  const toCopy = prevRows.filter((r) => !existing.has(r.concept.toLowerCase()));
  if (toCopy.length > 0)
    await db.insert(schema.fixedExpenses).values(
      toCopy.map((r) => ({
        month: target,
        concept: r.concept,
        category: r.category,
        amount: r.amount,
        notes: r.notes,
      })),
    );
  return { copied: toCopy.length, skipped: prevRows.length - toCopy.length, from: previous.slice(0, 7) };
}

// ------------------------------------------------------------------------------------------------
// Retiros de los socios (parámetro del negocio)
// ------------------------------------------------------------------------------------------------

export async function getPartnerWithdrawals(db: Executor): Promise<{ amount: number; isDefault: boolean }> {
  const [row] = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, SETTING_WITHDRAWALS))
    .limit(1);
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n >= 0
    ? { amount: n, isDefault: false }
    : { amount: DEFAULT_WITHDRAWALS, isDefault: true };
}

/** Upsert del parámetro en app_settings (siempre dentro de action() para que quede auditado). */
export async function setPartnerWithdrawals(db: Executor, amount: number) {
  await db
    .insert(schema.appSettings)
    .values({
      key: SETTING_WITHDRAWALS,
      value: amount,
      description: "Retiros mensuales de los socios, en total (para comparar con el resultado)",
    })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: amount } });
  return { amount };
}

// ------------------------------------------------------------------------------------------------
// RF-39: costos por producto, desglose y simulador
// ------------------------------------------------------------------------------------------------

export interface CostOverview {
  costs: ProductCosts;
  /** Categoría de cada insumo de la receta (para agrupar lácteos). */
  categoryByIngredient: Record<string, string>;
  /** Lácteos (quesos, manteca y leche) como % del costo de ingredientes. null si falta algún precio. */
  dairyPctOfIngredients: number | null;
  /** Quesos (barra y reggianito) como % del costo de ingredientes. */
  cheesePctOfIngredients: number | null;
  /** Costo de ingredientes de una producción (75 kg de fécula). */
  ingredientsCostPerRun: number | null;
  /** Lo que el Excel calculaba mal: ingredientes ÷ 163,5 kg (suma de ingredientes) vs ÷ kg realmente pesados. */
  excel: {
    excelKg: number;
    realKg: number;
    ingredientsPerKgExcel: number | null;
    ingredientsPerKgReal: number | null;
    underestimatedPct: number | null;
  };
  /** Listas de precios con el precio vigente de cada producto, para ver márgenes en el simulador. */
  priceLists: {
    id: string;
    name: string;
    channel: string;
    targetMarginPct: number;
    prices: Record<string, number | null>;
  }[];
}

export async function getCostOverview(db: Executor, today: IsoDate = todayAR()): Promise<CostOverview> {
  const costs = await getProductCosts(db, today);
  const [ingredients, matrix] = await Promise.all([
    db.select({ id: schema.ingredients.id, category: schema.ingredients.category }).from(schema.ingredients),
    getPriceMatrix(db, today, costs),
  ]);
  const categoryByIngredient = Object.fromEntries(ingredients.map((i) => [i.id, i.category]));
  const totalRun = costs.ingredients.every((l) => l.costPerRun != null)
    ? roundMoney(costs.ingredients.reduce((a, l) => a + (l.costPerRun ?? 0), 0))
    : null;
  const share = (pick: (l: ProductCosts["ingredients"][number]) => boolean) =>
    totalRun
      ? Math.round(
          (costs.ingredients.filter(pick).reduce((a, l) => a + (l.costPerRun ?? 0), 0) / totalRun) * 1000,
        ) / 10
      : null;
  const dairy = share((l) => ["dairy", "fat"].includes(categoryByIngredient[l.ingredientId] ?? ""));
  const cheese = share((l) => isCheese(l.name));
  const ingredientsPerKgExcel = totalRun != null ? roundMoney(totalRun / EXCEL_YIELD_KG) : null;
  const ingredientsPerKgReal = totalRun != null ? roundMoney(totalRun / costs.producedKgPerRun) : null;
  return {
    costs,
    categoryByIngredient,
    dairyPctOfIngredients: dairy,
    cheesePctOfIngredients: cheese,
    ingredientsCostPerRun: totalRun,
    excel: {
      excelKg: EXCEL_YIELD_KG,
      realKg: costs.producedKgPerRun,
      ingredientsPerKgExcel,
      ingredientsPerKgReal,
      underestimatedPct:
        ingredientsPerKgExcel != null && ingredientsPerKgReal
          ? Math.round((1 - ingredientsPerKgExcel / ingredientsPerKgReal) * 1000) / 10
          : null,
    },
    priceLists: matrix.lists.map((l) => ({
      id: l.id,
      name: l.name,
      channel: l.channel,
      targetMarginPct: l.targetMarginPct,
      prices: Object.fromEntries(l.rows.map((r) => [r.productId, r.price])),
    })),
  };
}

// ------------------------------------------------------------------------------------------------
// RF-40: resultado mensual
// ------------------------------------------------------------------------------------------------

const CREDIT_NOTES = ["NC_A", "NC_B", "NC_C"] as const;
const DELIVERED_STATUSES = ["delivered", "invoiced", "paid"] as const;

export interface CostOfSalesLine {
  productId: string;
  name: string;
  units: number;
  /** Ingredientes + envase/componentes por unidad (sin mano de obra, que se resta aparte). */
  unitMaterialCost: number;
  cost: number;
}

export interface MonthlyResultDetail {
  month: string;
  from: IsoDate;
  /** Último día del mes. */
  to: IsoDate;
  salesByChannel: { channel: string; net: number; total: number; documents: number }[];
  sales: number;
  costOfSales: {
    total: number;
    lines: CostOfSalesLine[];
    unitsFromInvoicedOrders: number;
    unitsFromStore: number;
    /** Productos vendidos cuyo costo está incompleto por precios faltantes (se subestima el costo). */
    underpriced: string[];
  };
  labor: { runs: number; perRun: number; total: number };
  fixed: {
    total: number;
    byCategory: FixedExpenses["byCategory"];
    missingCategories: FixedExpenses["missingCategories"];
  };
  delivery: DeliveryCostSummary;
  grossMargin: number;
  result: number;
  resultPct: number | null;
  withdrawals: {
    amount: number;
    isDefault: boolean;
    covers: boolean;
    difference: number;
    coveragePct: number | null;
  };
  /** Datos que no entran en la cuenta y conviene conocer. */
  notices: {
    /** Pedidos entregados en el mes que no tienen factura (no suman ventas ni costo). */
    deliveredWithoutInvoice: { orders: number; amount: number };
    /** Facturas del mes sin pedido asociado (suman ventas, pero no tienen costo de ventas). */
    invoicesWithoutOrder: { count: number; net: number };
  };
  /** Falso si el mes no tiene ventas, producciones ni gastos cargados. */
  hasData: boolean;
}

/** Unidades facturadas en el mes por producto: ítems de los pedidos con factura emitida en el mes. */
async function invoicedOrderUnits(db: Executor, from: IsoDate, to: IsoDate) {
  const si = schema.salesInvoices;
  const invoicedOrders = db
    .select({ id: si.orderId })
    .from(si)
    .where(
      and(
        isNotNull(si.orderId),
        ne(si.status, "voided"),
        notInArray(si.invoiceType, [...CREDIT_NOTES]),
        gte(si.issueDate, from),
        lt(si.issueDate, to),
      ),
    );
  const rows = await db
    .select({
      productId: schema.orderItems.productId,
      units: sql<number>`coalesce(sum(${schema.orderItems.qtyUnits}), 0)::int`,
    })
    .from(schema.orderItems)
    .where(inArray(schema.orderItems.orderId, invoicedOrders))
    .groupBy(schema.orderItems.productId);
  return new Map(rows.map((r) => [r.productId, r.units]));
}

async function storeUnits(db: Executor, from: IsoDate, to: IsoDate) {
  const soldDay = sql`(${schema.storeSales.soldAt} at time zone ${TZ})::date`;
  const rows = await db
    .select({
      productId: schema.storeSaleItems.productId,
      units: sql<number>`coalesce(sum(${schema.storeSaleItems.qtyUnits}), 0)::int`,
    })
    .from(schema.storeSaleItems)
    .innerJoin(schema.storeSales, eq(schema.storeSales.id, schema.storeSaleItems.saleId))
    .where(and(sql`${soldDay} >= ${from}::date`, sql`${soldDay} < ${to}::date`))
    .groupBy(schema.storeSaleItems.productId);
  return new Map(rows.map((r) => [r.productId, r.units]));
}

async function productionRunsIn(db: Executor, from: IsoDate, to: IsoDate) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.productionRuns)
    .where(
      and(
        gte(schema.productionRuns.date, from),
        lt(schema.productionRuns.date, to),
        notInArray(schema.productionRuns.status, ["planned", "cancelled"]),
      ),
    );
  return row?.n ?? 0;
}

async function noticesFor(db: Executor, from: IsoDate, to: IsoDate) {
  const o = schema.orders;
  const si = schema.salesInvoices;
  const deliveredDay = sql`(${o.deliveredAt} at time zone ${TZ})::date`;
  const hasInvoice = sql`exists (select 1 from sales_invoices si where si.order_id = ${o.id} and si.status <> 'voided')`;
  const [[undelivered], [orphan]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${o.total}), 0)::float8` })
      .from(o)
      .where(
        and(
          inArray(o.status, [...DELIVERED_STATUSES]),
          sql`${deliveredDay} >= ${from}::date`,
          sql`${deliveredDay} < ${to}::date`,
          sql`not ${hasInvoice}`,
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int`, net: sql<number>`coalesce(sum(${si.netTotal}), 0)::float8` })
      .from(si)
      .where(
        and(
          isNull(si.orderId),
          ne(si.status, "voided"),
          notInArray(si.invoiceType, [...CREDIT_NOTES]),
          gte(si.issueDate, from),
          lt(si.issueDate, to),
        ),
      ),
  ]);
  return {
    deliveredWithoutInvoice: { orders: undelivered?.n ?? 0, amount: roundMoney(undelivered?.amount ?? 0) },
    invoicesWithoutOrder: { count: orphan?.n ?? 0, net: roundMoney(orphan?.net ?? 0) },
  };
}

/** Costo de materiales (ingredientes + envase y componentes) por unidad de cada producto, a precios actuales. */
export function materialUnitCosts(
  costs: ProductCosts,
): Map<string, { name: string; cost: number; complete: boolean }> {
  const ingredientsPerKg =
    costs.ingredientsCostPerKg ??
    // Con precios faltantes en la receta: lo que se puede costear (se avisa como subestimado).
    roundMoney(costs.ingredients.reduce((a, l) => a + (l.costPerKgProduct ?? 0), 0));
  return new Map(
    costs.products.map((p) => [
      p.productId,
      {
        name: p.name,
        cost: roundMoney(ingredientsPerKg * p.netWeightKg + p.componentsCost),
        complete: p.missingPrices.length === 0,
      },
    ]),
  );
}

/**
 * RF-40: resultado del mes.
 *  - Ventas: facturas emitidas en el mes (neto sin IVA) + local, por canal (`getSalesByChannel`).
 *  - Costo de ventas (aproximación): unidades de los pedidos con factura emitida en el mes + unidades vendidas
 *    en el local, × costo de materiales por unidad a los ÚLTIMOS precios de compra. Excluye la mano de obra
 *    (se resta aparte) para no contarla dos veces.
 *  - Mano de obra de planta: producciones del mes × costo de una producción (settings `labor.*`).
 *  - Gastos fijos del mes, costo de reparto del mes, y comparación con los retiros de los socios.
 */
export async function getMonthlyResult(
  db: Executor,
  month: string,
  opts: { today?: IsoDate; costs?: ProductCosts; withdrawals?: { amount: number; isDefault: boolean } } = {},
): Promise<MonthlyResultDetail> {
  assertMonth(month);
  const { from, to } = monthBounds(month);
  const today = opts.today ?? todayAR();
  const [costs, sales, fixed, delivery, runs, invoiced, store, notices, withdrawals] = await Promise.all([
    opts.costs ?? getProductCosts(db, today),
    getSalesByChannel(db, month),
    listFixedExpenses(db, month),
    getDeliveryCostSummary(db, month),
    productionRunsIn(db, from, to),
    invoicedOrderUnits(db, from, to),
    storeUnits(db, from, to),
    noticesFor(db, from, to),
    opts.withdrawals ?? getPartnerWithdrawals(db),
  ]);

  const unitCosts = materialUnitCosts(costs);
  const unitsByProduct = new Map<string, number>();
  for (const m of [invoiced, store])
    for (const [id, n] of m) unitsByProduct.set(id, (unitsByProduct.get(id) ?? 0) + n);
  const lines: CostOfSalesLine[] = [];
  const underpriced: string[] = [];
  for (const [productId, units] of unitsByProduct) {
    const u = unitCosts.get(productId);
    if (!u || units === 0) continue;
    if (!u.complete) underpriced.push(u.name);
    lines.push({
      productId,
      name: u.name,
      units,
      unitMaterialCost: u.cost,
      cost: roundMoney(units * u.cost),
    });
  }
  lines.sort((a, b) => b.cost - a.cost);
  const costOfSales = roundMoney(lines.reduce((a, l) => a + l.cost, 0));
  const labor = roundMoney(runs * costs.labor.costPerRun);

  const salesNet = Object.fromEntries(Object.entries(sales.byChannel).map(([ch, v]) => [ch, v.net]));
  const r = monthlyResult({
    salesByChannel: salesNet,
    costOfSales,
    labor,
    fixed: fixed.total,
    delivery: delivery.cost,
  });
  const cover = withdrawalsCoverage(r.result, withdrawals.amount);
  const salesByChannel = Object.entries(sales.byChannel)
    .map(([channel, v]) => ({ channel, ...v }))
    .sort((a, b) => b.net - a.net);

  return {
    month,
    from,
    to: addDays(to, -1),
    salesByChannel,
    sales: r.sales,
    costOfSales: {
      total: costOfSales,
      lines,
      unitsFromInvoicedOrders: [...invoiced.values()].reduce((a, n) => a + n, 0),
      unitsFromStore: [...store.values()].reduce((a, n) => a + n, 0),
      underpriced,
    },
    labor: { runs, perRun: costs.labor.costPerRun, total: labor },
    fixed: { total: fixed.total, byCategory: fixed.byCategory, missingCategories: fixed.missingCategories },
    delivery,
    grossMargin: r.grossMargin,
    result: r.result,
    resultPct: r.resultPct,
    withdrawals: { ...withdrawals, ...cover },
    notices,
    hasData: r.sales !== 0 || runs > 0 || fixed.rows.length > 0 || delivery.routes > 0,
  };
}

export interface ResultHistoryPoint {
  month: string;
  sales: number;
  result: number;
  resultPct: number | null;
  hasData: boolean;
}

/** Evolución del resultado de los últimos `months` meses (el último es `month`). */
export async function getResultHistory(
  db: Executor,
  month: string,
  months = 6,
  opts: { today?: IsoDate } = {},
): Promise<ResultHistoryPoint[]> {
  assertMonth(month);
  const today = opts.today ?? todayAR();
  const [costs, withdrawals] = await Promise.all([getProductCosts(db, today), getPartnerWithdrawals(db)]);
  const results = await Promise.all(
    monthsBack(month, months).map((m) => getMonthlyResult(db, m, { today, costs, withdrawals })),
  );
  return results.map((r) => ({
    month: r.month,
    sales: r.sales,
    result: r.result,
    resultPct: r.resultPct,
    hasData: r.hasData,
  }));
}
