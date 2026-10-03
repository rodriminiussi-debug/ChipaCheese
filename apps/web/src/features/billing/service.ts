import {
  accountBalance,
  addDays,
  addMonths,
  agingBuckets,
  applyFifo,
  roundMoney,
  statementWithRunningBalance,
  type AgingBuckets,
  type Charge,
  type Credit,
  type IsoDate,
  type StatementRow,
} from "@chipa/domain";
import { and, asc, desc, eq, gte, inArray, lt, ne, schema, sql, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import { todayAR } from "@/lib/dates";
import { PAYMENT_METHOD } from "@/lib/labels";
import { changeOrderStatus } from "@/features/orders/service";
import { INVOICE_TYPE_LABEL } from "./labels";
import type { CheckStatusData, InvoiceData, PaymentData } from "./schemas";

/**
 * M6 · Ventas, facturación y cobranzas (RF-30, RF-31).
 *
 * Cuenta corriente = cargos (facturas emitidas, vencen emisión + plazo del cliente) − créditos
 * (cobros y notas de crédito). Un cheque rechazado deja de ser crédito: la deuda vuelve. Los créditos
 * se imputan por vencimiento ascendente (FIFO, `applyFifo`). Nada se guarda: todo se deriva de los hechos.
 */

export const CHECK_ALERT_DAYS = 7;
const NC_TYPES = new Set(["NC_A", "NC_B", "NC_C"]);

// ------------------------------------------------------------------------------------------------
// Libro de la cuenta corriente
// ------------------------------------------------------------------------------------------------

type InvoiceRow = typeof schema.salesInvoices.$inferSelect;
type PaymentRow = typeof schema.customerPayments.$inferSelect & {
  checks: (typeof schema.checks.$inferSelect)[];
};

interface Ledger {
  customerId: string;
  invoices: InvoiceRow[];
  payments: PaymentRow[];
}

/** Importe de un cobro que realmente cuenta como crédito: sin los cheques rechazados. */
export function effectivePaymentAmount(p: PaymentRow): number {
  const rejected = p.checks.filter((c) => c.status === "rejected").reduce((a, c) => a + c.amount, 0);
  return roundMoney(Math.max(0, p.amount - rejected));
}

async function loadLedgers(db: Executor, customerIds?: string[]): Promise<Map<string, Ledger>> {
  const si = schema.salesInvoices;
  const cp = schema.customerPayments;
  const [invoices, payments] = await Promise.all([
    db
      .select()
      .from(si)
      .where(and(ne(si.status, "voided"), customerIds ? inArray(si.customerId, customerIds) : undefined)),
    db.query.customerPayments.findMany({
      where: customerIds ? inArray(cp.customerId, customerIds) : undefined,
      with: { checks: true },
    }),
  ]);
  const out = new Map<string, Ledger>();
  const get = (id: string) =>
    out.get(id) ?? out.set(id, { customerId: id, invoices: [], payments: [] }).get(id)!;
  for (const i of invoices) get(i.customerId).invoices.push(i);
  for (const p of payments) get(p.customerId).payments.push(p);
  for (const id of customerIds ?? []) get(id);
  return out;
}

function chargesOf(l: Ledger): Charge[] {
  return l.invoices
    .filter((i) => !NC_TYPES.has(i.invoiceType))
    .map((i) => ({ id: i.id, date: i.issueDate, dueDate: i.dueDate, amount: i.total }));
}
function creditsOf(l: Ledger): Credit[] {
  return [
    ...l.payments
      .map((p) => ({ id: p.id, date: p.date, amount: effectivePaymentAmount(p) }))
      .filter((c) => c.amount > 0),
    ...l.invoices
      .filter((i) => NC_TYPES.has(i.invoiceType))
      .map((i) => ({ id: i.id, date: i.issueDate, amount: i.total })),
  ];
}

function overdueOf(b: AgingBuckets) {
  return roundMoney(b.d1_30 + b.d31_60 + b.d61_90 + b.d90_plus);
}

function computeAccount(l: Ledger, today: IsoDate) {
  const charges = chargesOf(l);
  const credits = creditsOf(l);
  const fifo = applyFifo(charges, credits);
  const buckets = agingBuckets(
    fifo.map((f) => ({ dueDate: f.dueDate, open: f.open })),
    today,
  );
  return {
    charges,
    credits,
    fifo,
    buckets,
    balance: accountBalance(charges, credits),
    overdue: overdueOf(buckets),
  };
}

const ZERO_BUCKETS: AgingBuckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };
function addBuckets(a: AgingBuckets, b: AgingBuckets): AgingBuckets {
  return {
    current: roundMoney(a.current + b.current),
    d1_30: roundMoney(a.d1_30 + b.d1_30),
    d31_60: roundMoney(a.d31_60 + b.d31_60),
    d61_90: roundMoney(a.d61_90 + b.d61_90),
    d90_plus: roundMoney(a.d90_plus + b.d90_plus),
    total: roundMoney(a.total + b.total),
  };
}

// ------------------------------------------------------------------------------------------------
// RF-30: cuentas corrientes
// ------------------------------------------------------------------------------------------------

export interface ReceivableRow {
  customerId: string;
  legalName: string;
  channel: string;
  paymentTermsDays: number;
  /** Positivo = el cliente debe; negativo = saldo a favor. */
  balance: number;
  overdue: number;
  buckets: AgingBuckets;
  /** Vencimiento de la factura impaga más antigua. */
  oldestDueDate: IsoDate | null;
  lastPaymentDate: IsoDate | null;
}

/** Clientes con saldo (deuda o saldo a favor), el más vencido primero. */
export async function getReceivables(db: Executor, today: IsoDate = todayAR()) {
  const [customers, ledgers] = await Promise.all([
    db.query.customers.findMany({ orderBy: asc(schema.customers.legalName) }),
    loadLedgers(db),
  ]);
  const rows: ReceivableRow[] = [];
  let buckets = ZERO_BUCKETS;
  for (const c of customers) {
    const ledger = ledgers.get(c.id);
    if (!ledger) continue;
    const acc = computeAccount(ledger, today);
    if (Math.abs(acc.balance) < 0.005 && acc.buckets.total < 0.005) continue;
    buckets = addBuckets(buckets, acc.buckets);
    const open = acc.fifo.filter((f) => f.open > 0).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    rows.push({
      customerId: c.id,
      legalName: c.legalName,
      channel: c.channel,
      paymentTermsDays: c.paymentTermsDays,
      balance: acc.balance,
      overdue: acc.overdue,
      buckets: acc.buckets,
      oldestDueDate: open[0]?.dueDate ?? null,
      lastPaymentDate:
        ledger.payments
          .map((p) => p.date)
          .sort()
          .at(-1) ?? null,
    });
  }
  rows.sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
  return {
    rows,
    buckets,
    total: buckets.total,
    overdue: overdueOf(buckets),
    customersWithDebt: rows.filter((r) => r.balance > 0.005).length,
  };
}
export type Receivables = Awaited<ReturnType<typeof getReceivables>>;

/** Resumen para el tablero (M8): deuda total, vencida, antigüedad y principales deudores. */
export async function getReceivablesSummary(db: Executor, today: IsoDate = todayAR()) {
  const r = await getReceivables(db, today);
  return {
    total: r.total,
    overdue: r.overdue,
    buckets: r.buckets,
    topDebtors: r.rows
      .filter((x) => x.balance > 0.005)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5)
      .map((x) => ({
        customerId: x.customerId,
        name: x.legalName,
        balance: x.balance,
        overdue: x.overdue,
      })),
  };
}
export type ReceivablesSummary = Awaited<ReturnType<typeof getReceivablesSummary>>;

export interface AccountInvoice {
  id: string;
  invoiceType: InvoiceRow["invoiceType"];
  label: string;
  issueDate: IsoDate;
  dueDate: IsoDate;
  total: number;
  paid: number;
  open: number;
  orderId: string | null;
  orderNumber: number | null;
  source: InvoiceRow["source"];
  state: "paid" | "current" | "overdue";
}

export interface AccountStatementRow extends StatementRow {
  label: string;
  detail: string | null;
}

export function invoiceLabel(i: Pick<InvoiceRow, "invoiceType" | "pointOfSale" | "number">) {
  return `${INVOICE_TYPE_LABEL[i.invoiceType]} ${i.pointOfSale}-${i.number}`;
}

/** Estado de cuenta de un cliente: facturas con lo imputado, movimientos con saldo y cobros. */
export async function getCustomerAccount(db: Executor, customerId: string, today: IsoDate = todayAR()) {
  const customer = await db.query.customers.findFirst({
    where: eq(schema.customers.id, customerId),
    with: { zone: true, priceList: true },
  });
  if (!customer) return null;
  const ledger = (await loadLedgers(db, [customerId])).get(customerId)!;
  const acc = computeAccount(ledger, today);

  const orderIds = ledger.invoices.map((i) => i.orderId).filter((x): x is string => !!x);
  const orders = orderIds.length
    ? await db
        .select({ id: schema.orders.id, number: schema.orders.number })
        .from(schema.orders)
        .where(inArray(schema.orders.id, orderIds))
    : [];
  const orderNumber = new Map(orders.map((o) => [o.id, o.number]));

  const fifoById = new Map(acc.fifo.map((f) => [f.chargeId, f]));
  const invoices: AccountInvoice[] = ledger.invoices
    .filter((i) => !NC_TYPES.has(i.invoiceType))
    .map((i) => {
      const f = fifoById.get(i.id)!;
      return {
        id: i.id,
        invoiceType: i.invoiceType,
        label: invoiceLabel(i),
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        total: i.total,
        paid: f.paid,
        open: f.open,
        orderId: i.orderId,
        orderNumber: i.orderId ? (orderNumber.get(i.orderId) ?? null) : null,
        source: i.source,
        state: f.open <= 0 ? "paid" : i.dueDate < today ? "overdue" : "current",
      } satisfies AccountInvoice;
    })
    .sort((a, b) => (a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0));

  const paymentById = new Map(ledger.payments.map((p) => [p.id, p]));
  const invoiceById = new Map(ledger.invoices.map((i) => [i.id, i]));
  const statement: AccountStatementRow[] = statementWithRunningBalance(acc.charges, acc.credits).map((r) => {
    if (r.kind === "charge") {
      const i = invoiceById.get(r.id)!;
      return { ...r, label: invoiceLabel(i), detail: `Vence ${i.dueDate.split("-").reverse().join("/")}` };
    }
    const p = paymentById.get(r.id);
    if (p) {
      const rejected = p.checks.filter((c) => c.status === "rejected");
      return {
        ...r,
        label: `Cobro · ${PAYMENT_METHOD[p.method] ?? p.method}`,
        detail:
          rejected.length > 0
            ? `Cheque rechazado N° ${rejected.map((c) => c.number).join(", ")}`
            : p.checks.length > 0
              ? `Cheque N° ${p.checks.map((c) => c.number).join(", ")}`
              : (p.reference ?? null),
      };
    }
    const nc = invoiceById.get(r.id)!;
    return { ...r, label: invoiceLabel(nc), detail: "Nota de crédito" };
  });

  const payments = [...ledger.payments].sort((a, b) => (a.date < b.date ? 1 : -1));
  const rejectedChecks = ledger.payments.flatMap((p) =>
    p.checks
      .filter((c) => c.status === "rejected")
      .map((c) => ({ id: c.id, bank: c.bank, number: c.number, amount: c.amount, paymentDate: p.date })),
  );
  return {
    customer,
    balance: acc.balance,
    overdue: acc.overdue,
    buckets: acc.buckets,
    invoices,
    statement,
    payments,
    /** Cheques rechazados: ya no cuentan como cobro, la deuda volvió. */
    rejectedChecks,
  };
}
export type CustomerAccount = NonNullable<Awaited<ReturnType<typeof getCustomerAccount>>>;

// ------------------------------------------------------------------------------------------------
// Alta de facturas
// ------------------------------------------------------------------------------------------------

/** Pedidos entregados aún sin facturar (de un cliente o de todos) para ligar la factura. */
export async function deliveredOrdersToInvoice(db: Executor, customerId?: string) {
  const o = schema.orders;
  return db
    .select({
      id: o.id,
      number: o.number,
      total: o.total,
      promisedDate: o.promisedDate,
      customerId: o.customerId,
    })
    .from(o)
    .where(and(eq(o.status, "delivered"), customerId ? eq(o.customerId, customerId) : undefined))
    .orderBy(desc(o.promisedDate));
}

/** Alta manual de una factura emitida; si se liga a un pedido entregado, el pedido pasa a "facturado". */
export async function createInvoice(
  db: Executor,
  userId: string | null,
  input: InvoiceData,
  today: IsoDate = todayAR(),
) {
  const customer = await db.query.customers.findFirst({ where: eq(schema.customers.id, input.customerId) });
  if (!customer) throw new UserError("El cliente no existe.");
  if (input.issueDate > today)
    throw new UserError("La fecha de emisión no puede ser futura.", { issueDate: ["Fecha futura"] });
  const dueDate = input.dueDate ?? addDays(input.issueDate, customer.paymentTermsDays);
  if (dueDate < input.issueDate)
    throw new UserError("El vencimiento no puede ser anterior a la emisión.", {
      dueDate: ["Anterior a la emisión"],
    });

  const si = schema.salesInvoices;
  const dup = await db.query.salesInvoices.findFirst({
    where: and(
      eq(si.invoiceType, input.invoiceType),
      eq(si.pointOfSale, input.pointOfSale),
      eq(si.number, input.number),
    ),
  });
  if (dup)
    throw new UserError(`Ya existe la factura ${input.invoiceType} ${input.pointOfSale}-${input.number}.`, {
      number: ["Factura duplicada"],
    });

  let orderId: string | null = null;
  if (input.orderId) {
    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, input.orderId) });
    if (!order) throw new UserError("El pedido no existe.");
    if (order.customerId !== customer.id) throw new UserError("El pedido es de otro cliente.");
    if (order.status !== "delivered")
      throw new UserError("Solo se puede facturar un pedido entregado.", {
        orderId: ["El pedido no está entregado"],
      });
    orderId = order.id;
  }

  const [invoice] = await db
    .insert(si)
    .values({
      customerId: customer.id,
      orderId,
      invoiceType: input.invoiceType,
      pointOfSale: input.pointOfSale,
      number: input.number,
      issueDate: input.issueDate,
      dueDate,
      netTotal: input.netTotal,
      vatTotal: input.vatTotal ?? 0,
      total: input.total,
      cae: input.cae,
      status: "confirmed",
      source: "manual",
    })
    .returning();
  if (orderId) {
    await changeOrderStatus(db, userId, {
      id: orderId,
      to: "invoiced",
      note: `Factura ${invoiceLabel(invoice!)}`,
    });
  }
  const settledOrders = await settleInvoicedOrders(db, userId, customer.id, today);
  return { invoice: invoice!, settledOrders };
}

/**
 * Cuando el FIFO deja saldadas todas las facturas de un pedido "facturado", el pedido pasa a "cobrado".
 * Devuelve los números de pedido que se cobraron.
 */
export async function settleInvoicedOrders(
  db: Executor,
  userId: string | null,
  customerId: string,
  today: IsoDate = todayAR(),
): Promise<number[]> {
  const ledger = (await loadLedgers(db, [customerId])).get(customerId)!;
  const withOrder = ledger.invoices.filter((i) => i.orderId && !NC_TYPES.has(i.invoiceType));
  if (withOrder.length === 0) return [];
  const { fifo } = computeAccount(ledger, today);
  const open = new Map(fifo.map((f) => [f.chargeId, f.open]));
  const byOrder = new Map<string, InvoiceRow[]>();
  for (const i of withOrder)
    (byOrder.get(i.orderId!) ?? byOrder.set(i.orderId!, []).get(i.orderId!)!).push(i);
  const settled: number[] = [];
  for (const [orderId, invoices] of byOrder) {
    if (!invoices.every((i) => (open.get(i.id) ?? 1) <= 0)) continue;
    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
    if (!order || order.status !== "invoiced") continue;
    await changeOrderStatus(db, userId, {
      id: orderId,
      to: "paid",
      note: "Facturas cobradas en su totalidad",
    });
    settled.push(order.number);
  }
  return settled;
}

// ------------------------------------------------------------------------------------------------
// RF-31: cobros y cheques
// ------------------------------------------------------------------------------------------------

export async function registerPayment(
  db: Executor,
  userId: string | null,
  input: PaymentData,
  today: IsoDate = todayAR(),
) {
  const customer = await db.query.customers.findFirst({ where: eq(schema.customers.id, input.customerId) });
  if (!customer) throw new UserError("El cliente no existe.");
  const date = input.date ?? today;
  if (date > today)
    throw new UserError("La fecha del cobro no puede ser futura.", { date: ["Fecha futura"] });

  if (input.routeId) {
    const route = await db.query.routes.findFirst({ where: eq(schema.routes.id, input.routeId) });
    if (!route) throw new UserError("La ruta no existe.");
  }

  const isCheck = input.method === "check";
  const amount = isCheck ? roundMoney(input.checks.reduce((a, c) => a + c.amount, 0)) : (input.amount ?? 0);
  if (!(amount > 0)) throw new UserError("El importe del cobro debe ser mayor a 0.");

  if (isCheck) {
    const numbers = new Set<string>();
    for (const c of input.checks) {
      const key = `${c.bank.toLowerCase()}|${c.number}`;
      if (numbers.has(key)) throw new UserError(`El cheque ${c.number} está repetido en este cobro.`);
      numbers.add(key);
      const dup = await db.query.checks.findFirst({
        where: and(
          eq(schema.checks.number, c.number),
          sql`lower(${schema.checks.bank}) = ${c.bank.toLowerCase()}`,
        ),
      });
      if (dup)
        throw new UserError(`El cheque ${c.number} de ${c.bank} ya está cargado.`, {
          checks: ["Cheque duplicado"],
        });
    }
  }

  const [payment] = await db
    .insert(schema.customerPayments)
    .values({
      customerId: customer.id,
      date,
      amount,
      method: input.method,
      routeId: input.routeId,
      receivedById: userId,
      reference: input.reference,
      notes: input.notes,
    })
    .returning();
  if (isCheck) {
    await db.insert(schema.checks).values(
      input.checks.map((c) => ({
        paymentId: payment!.id,
        bank: c.bank,
        number: c.number,
        issuer: c.issuer ?? customer.legalName,
        amount: c.amount,
        issueDate: c.issueDate,
        cashDate: c.cashDate,
      })),
    );
  }
  const settledOrders = await settleInvoicedOrders(db, userId, customer.id, today);
  return { payment: payment!, settledOrders };
}

const CHECK_TRANSITIONS: Record<string, string[]> = {
  in_portfolio: ["deposited", "cashed", "endorsed", "rejected"],
  deposited: ["cashed", "rejected"],
  cashed: [],
  rejected: [],
  endorsed: [],
};

/** Cambia el estado de un cheque en cartera. Un cheque rechazado deja de ser crédito: el cliente vuelve a deber. */
export async function setCheckStatus(db: Executor, input: CheckStatusData) {
  const check = await db.query.checks.findFirst({ where: eq(schema.checks.id, input.checkId) });
  if (!check) throw new UserError("El cheque no existe.");
  if (!CHECK_TRANSITIONS[check.status]?.includes(input.status))
    throw new UserError("Ese cambio de estado no es válido para el cheque.");
  const [row] = await db
    .update(schema.checks)
    .set({ status: input.status, ...(input.notes ? { notes: input.notes } : {}) })
    .where(eq(schema.checks.id, check.id))
    .returning();
  return row!;
}

export interface CheckRow {
  id: string;
  bank: string;
  number: string;
  issuer: string | null;
  amount: number;
  cashDate: IsoDate;
  status: (typeof schema.checkStatusEnum.enumValues)[number];
  notes: string | null;
  customerId: string;
  customerName: string;
  paymentDate: IsoDate;
  /** Días hasta la fecha de cobro (negativo = ya se puede depositar hace X días). */
  daysToCash: number;
  /** En cartera y a cobrar en los próximos 7 días. */
  dueSoon: boolean;
  /** En cartera y con fecha de cobro cumplida: hay que depositarlo. */
  readyToDeposit: boolean;
}

/** Cartera de cheques ordenada por fecha de cobro. `scope`: "active" (cartera + depositados) o "all". */
export async function listChecks(
  db: Executor,
  opts: { scope?: "active" | "all" | CheckRow["status"] } = {},
  today: IsoDate = todayAR(),
) {
  const scope = opts.scope ?? "active";
  const c = schema.checks;
  const p = schema.customerPayments;
  const rows = await db
    .select({
      id: c.id,
      bank: c.bank,
      number: c.number,
      issuer: c.issuer,
      amount: c.amount,
      cashDate: c.cashDate,
      status: c.status,
      notes: c.notes,
      customerId: p.customerId,
      customerName: schema.customers.legalName,
      paymentDate: p.date,
    })
    .from(c)
    .innerJoin(p, eq(p.id, c.paymentId))
    .innerJoin(schema.customers, eq(schema.customers.id, p.customerId))
    .where(
      scope === "all"
        ? undefined
        : scope === "active"
          ? inArray(c.status, ["in_portfolio", "deposited"])
          : eq(c.status, scope),
    )
    .orderBy(asc(c.cashDate), asc(c.number));
  const limit = addDays(today, CHECK_ALERT_DAYS);
  const list: CheckRow[] = rows.map((r) => {
    const inPortfolio = r.status === "in_portfolio";
    return {
      ...r,
      daysToCash: Math.round(
        (Date.parse(`${r.cashDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
      ),
      dueSoon: inPortfolio && r.cashDate >= today && r.cashDate <= limit,
      readyToDeposit: inPortfolio && r.cashDate < today,
    };
  });
  const sum = (xs: CheckRow[]) => roundMoney(xs.reduce((a, x) => a + x.amount, 0));
  const inPortfolio = list.filter((x) => x.status === "in_portfolio");
  return {
    rows: list,
    totals: {
      inPortfolio: sum(inPortfolio),
      dueSoon: sum(list.filter((x) => x.dueSoon)),
      dueSoonCount: list.filter((x) => x.dueSoon).length,
      readyToDeposit: sum(list.filter((x) => x.readyToDeposit)),
      readyToDepositCount: list.filter((x) => x.readyToDeposit).length,
    },
  };
}
export type CheckPortfolio = Awaited<ReturnType<typeof listChecks>>;

/** Cheques en cartera a cobrar en los próximos N días (alerta del tablero). */
export async function getChecksDueSoon(db: Executor, today: IsoDate = todayAR(), days = CHECK_ALERT_DAYS) {
  const c = schema.checks;
  return db
    .select({ id: c.id, number: c.number, bank: c.bank, amount: c.amount, cashDate: c.cashDate })
    .from(c)
    .where(
      and(eq(c.status, "in_portfolio"), gte(c.cashDate, today), lt(c.cashDate, addDays(today, days + 1))),
    )
    .orderBy(asc(c.cashDate));
}

// ------------------------------------------------------------------------------------------------
// RF-31: pantalla de ruta (chofer)
// ------------------------------------------------------------------------------------------------

/** Clientes de las paradas de una ruta con su saldo, y lo cobrado en ruta. */
export async function getRouteCollections(db: Executor, routeId: string, today: IsoDate = todayAR()) {
  const route = await db.query.routes.findFirst({
    where: eq(schema.routes.id, routeId),
    with: {
      driver: true,
      stops: { with: { order: true, customer: true }, orderBy: asc(schema.routeStops.seq) },
    },
  });
  if (!route) return null;

  const stopCustomers = new Map<string, { seq: number; done: boolean }>();
  for (const s of route.stops) {
    const customerId = s.customerId ?? s.order?.customerId ?? null;
    if (!customerId || stopCustomers.has(customerId)) continue;
    stopCustomers.set(customerId, { seq: s.seq, done: !!s.doneAt });
  }
  const ids = [...stopCustomers.keys()];
  const [customers, ledgers, payments] = await Promise.all([
    ids.length ? db.query.customers.findMany({ where: inArray(schema.customers.id, ids) }) : [],
    ids.length ? loadLedgers(db, ids) : new Map<string, Ledger>(),
    db.query.customerPayments.findMany({
      where: eq(schema.customerPayments.routeId, routeId),
      with: { customer: true, checks: true },
      orderBy: desc(schema.customerPayments.createdAt),
    }),
  ]);
  const byId = new Map(customers.map((c) => [c.id, c]));
  const stops = ids
    .map((id) => {
      const c = byId.get(id)!;
      const acc = computeAccount(ledgers.get(id)!, today);
      return {
        customerId: id,
        legalName: c.legalName,
        paymentTermsDays: c.paymentTermsDays,
        seq: stopCustomers.get(id)!.seq,
        done: stopCustomers.get(id)!.done,
        balance: acc.balance,
        overdue: acc.overdue,
        collectedOnRoute: roundMoney(
          payments.filter((p) => p.customerId === id).reduce((a, p) => a + p.amount, 0),
        ),
      };
    })
    .sort((a, b) => a.seq - b.seq);

  const byMethod: Record<string, number> = {};
  for (const p of payments) byMethod[p.method] = roundMoney((byMethod[p.method] ?? 0) + p.amount);
  return {
    route: { id: route.id, date: route.date, status: route.status, driverName: route.driver?.name ?? null },
    stops,
    payments,
    collectedTotal: roundMoney(payments.reduce((a, p) => a + p.amount, 0)),
    collectedByMethod: byMethod,
  };
}
export type RouteCollections = NonNullable<Awaited<ReturnType<typeof getRouteCollections>>>;

/** Rutas con paradas del día (para elegir en qué ruta se cobra). */
export async function routesForDate(db: Executor, date: IsoDate) {
  return db.query.routes.findMany({
    where: eq(schema.routes.date, date),
    with: { stops: true },
    orderBy: asc(schema.routes.createdAt),
  });
}

// ------------------------------------------------------------------------------------------------
// Ventas por canal (lo consume el tablero M8) y exportación
// ------------------------------------------------------------------------------------------------

export function monthBounds(month: string): { from: IsoDate; to: IsoDate } {
  const from = `${month}-01`;
  return { from, to: addMonths(from, 1) };
}

export interface ChannelSales {
  /** Sin IVA. */
  net: number;
  /** Con IVA. */
  total: number;
  documents: number;
}

/** IVA supuesto para las ventas del local (que no guardan el desglose): precios minoristas con IVA incluido. */
export const STORE_VAT_RATE = 21;

/**
 * Ventas del mes por canal: facturas emitidas agrupadas por el canal del cliente (las notas de crédito
 * restan) + ventas del local como canal `store`. Las ventas del local no guardan IVA: se asume 21 % incluido.
 */
export async function getSalesByChannel(db: Executor, month: string) {
  const { from, to } = monthBounds(month);
  const si = schema.salesInvoices;
  const invoices = await db
    .select({
      type: si.invoiceType,
      net: si.netTotal,
      total: si.total,
      channel: schema.customers.channel,
    })
    .from(si)
    .innerJoin(schema.customers, eq(schema.customers.id, si.customerId))
    .where(and(ne(si.status, "voided"), gte(si.issueDate, from), lt(si.issueDate, to)));

  const storeSales = await db
    .select({
      total: sql<number>`coalesce(sum(${schema.storeSales.total}), 0)::float8`,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.storeSales)
    .where(
      and(
        sql`(${schema.storeSales.soldAt} at time zone 'America/Argentina/Buenos_Aires')::date >= ${from}::date`,
        sql`(${schema.storeSales.soldAt} at time zone 'America/Argentina/Buenos_Aires')::date < ${to}::date`,
      ),
    );

  const byChannel: Record<string, ChannelSales> = {};
  const add = (ch: string, net: number, total: number) => {
    const cur = (byChannel[ch] ??= { net: 0, total: 0, documents: 0 });
    cur.net = roundMoney(cur.net + net);
    cur.total = roundMoney(cur.total + total);
    cur.documents += 1;
  };
  for (const i of invoices) {
    const sign = NC_TYPES.has(i.type) ? -1 : 1;
    add(i.channel, sign * i.net, sign * i.total);
  }
  const store = storeSales[0]!;
  if (store.n > 0) {
    const cur = (byChannel.store ??= { net: 0, total: 0, documents: 0 });
    cur.total = roundMoney(cur.total + store.total);
    cur.net = roundMoney(cur.net + store.total / (1 + STORE_VAT_RATE / 100));
    cur.documents += store.n;
  }
  const values = Object.values(byChannel);
  return {
    month,
    byChannel,
    net: roundMoney(values.reduce((a, v) => a + v.net, 0)),
    total: roundMoney(values.reduce((a, v) => a + v.total, 0)),
  };
}
export type SalesByChannel = Awaited<ReturnType<typeof getSalesByChannel>>;

/** Facturas emitidas y cobros de un mes (exportación para la contadora). */
export async function getBillingExportData(db: Executor, month: string) {
  const { from, to } = monthBounds(month);
  const si = schema.salesInvoices;
  const cp = schema.customerPayments;
  const [invoices, payments] = await Promise.all([
    db
      .select({
        invoice: si,
        customerName: schema.customers.legalName,
        cuit: schema.customers.cuit,
      })
      .from(si)
      .innerJoin(schema.customers, eq(schema.customers.id, si.customerId))
      .where(and(gte(si.issueDate, from), lt(si.issueDate, to)))
      .orderBy(asc(si.issueDate), asc(si.pointOfSale), asc(si.number)),
    db.query.customerPayments.findMany({
      where: and(gte(cp.date, from), lt(cp.date, to)),
      with: { customer: true, checks: true },
      orderBy: [asc(cp.date), asc(cp.createdAt)],
    }),
  ]);
  return { month, invoices, payments };
}
