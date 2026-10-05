import { addDays, diffDays, expiringLots, nextWorkdays, priceIncreases, type IsoDate } from "@chipa/domain";
import { and, eq, inArray, lt, notInArray, schema, sql, type Executor } from "@chipa/db";

/**
 * Datos de las alertas del tablero que salen de otros módulos: lotes por vencer, entregas de proveedores
 * atrasadas, aumentos de precio de compra y pedidos del próximo día hábil sin preparar. Consultas de solo lectura.
 */

/** Umbrales por defecto (settings `alerts.*`). */
export const FINISHED_EXPIRY_DAYS = 30;
export const RAW_EXPIRY_DAYS = 7;
export const PRICE_INCREASE_PCT = 5;
/** Ventana (días) en la que cuenta un aumento de precio. */
export const PRICE_INCREASE_WINDOW_DAYS = 30;

export interface AlertThresholds {
  finishedExpiryDays: number;
  rawExpiryDays: number;
  priceIncreasePct: number;
}

// ------------------------------------------------------------------------------------------------
// Lotes por vencer
// ------------------------------------------------------------------------------------------------

export interface ExpiringLotsAlert {
  /** Umbral en días (`alerts.finished_expiry_days` / `alerts.raw_expiry_days`). */
  thresholdDays: number;
  /** Lotes con saldo que vencen dentro del umbral (o ya vencieron). */
  count: number;
  /** Cuántos de ellos ya están vencidos. */
  expired: number;
  /** Los 5 más próximos. */
  items: { name: string; lot: string; daysLeft: number; qty: number }[];
}

export interface ExpiryAlerts {
  finished: ExpiringLotsAlert;
  raw: ExpiringLotsAlert;
}

function toAlert(lots: ReturnType<typeof expiringLots>, thresholdDays: number): ExpiringLotsAlert {
  return {
    thresholdDays,
    count: lots.length,
    expired: lots.filter((l) => l.daysLeft < 0).length,
    items: lots.slice(0, 5).map((l) => ({ name: l.name, lot: l.lot, daysLeft: l.daysLeft, qty: l.qty })),
  };
}

/**
 * Lotes con saldo por vencer: producto terminado a ≤ `finishedDays` días y materia prima a ≤ `rawDays`.
 * Cuenta lotes (no unidades) e incluye los que ya vencieron y todavía tienen stock.
 */
export async function getExpiryAlerts(
  db: Executor,
  today: IsoDate,
  opts: { finishedDays: number; rawDays: number },
): Promise<ExpiryAlerts> {
  const [finished, raw] = await Promise.all([
    db
      .select({
        lot: schema.finishedLots.code,
        name: schema.products.name,
        expiryDate: schema.finishedLots.expiryDate,
        qty: sql<number>`sum(${schema.productStock.qty})::float8`,
      })
      .from(schema.productStock)
      .innerJoin(schema.finishedLots, eq(schema.finishedLots.id, schema.productStock.finishedLotId))
      .innerJoin(schema.products, eq(schema.products.id, schema.productStock.productId))
      .where(sql`${schema.finishedLots.expiryDate} <= ${addDays(today, opts.finishedDays)}::date`)
      .groupBy(
        schema.finishedLots.id,
        schema.finishedLots.code,
        schema.products.name,
        schema.finishedLots.expiryDate,
      ),
    db
      .select({
        lot: sql<string>`coalesce(${schema.rawLots.supplierLotCode}, '')`,
        name: schema.ingredients.name,
        expiryDate: schema.rawLots.expiryDate,
        qty: sql<number>`sum(${schema.ingredientStock.qty})::float8`,
      })
      .from(schema.ingredientStock)
      .innerJoin(schema.rawLots, eq(schema.rawLots.id, schema.ingredientStock.rawLotId))
      .innerJoin(schema.ingredients, eq(schema.ingredients.id, schema.ingredientStock.ingredientId))
      .where(sql`${schema.rawLots.expiryDate} <= ${addDays(today, opts.rawDays)}::date`)
      .groupBy(
        schema.rawLots.id,
        schema.rawLots.supplierLotCode,
        schema.ingredients.name,
        schema.rawLots.expiryDate,
      ),
  ]);
  return {
    finished: toAlert(expiringLots(finished, today, opts.finishedDays), opts.finishedDays),
    raw: toAlert(expiringLots(raw, today, opts.rawDays), opts.rawDays),
  };
}

// ------------------------------------------------------------------------------------------------
// Entregas de proveedores atrasadas
// ------------------------------------------------------------------------------------------------

export interface LateSupplierOrders {
  count: number;
  /** Las 5 más atrasadas. */
  items: { number: string; supplier: string; expectedAt: IsoDate; daysLate: number }[];
}

/** Órdenes de compra enviadas o recibidas a medias cuya fecha esperada ya pasó. */
export async function getLateSupplierOrders(db: Executor, today: IsoDate): Promise<LateSupplierOrders> {
  const po = schema.purchaseOrders;
  const rows = await db
    .select({
      number: po.number,
      expectedAt: po.expectedAt,
      supplier: sql<string>`coalesce(${schema.suppliers.tradeName}, ${schema.suppliers.legalName})`,
    })
    .from(po)
    .innerJoin(schema.suppliers, eq(schema.suppliers.id, po.supplierId))
    .where(and(inArray(po.status, ["sent", "partially_received"]), lt(po.expectedAt, today)))
    .orderBy(po.expectedAt, po.number);
  return {
    count: rows.length,
    items: rows.slice(0, 5).map((r) => ({
      number: r.number,
      supplier: r.supplier,
      expectedAt: r.expectedAt!,
      daysLate: diffDays(today, r.expectedAt!),
    })),
  };
}

// ------------------------------------------------------------------------------------------------
// Aumentos de precio de compra
// ------------------------------------------------------------------------------------------------

export interface PriceIncreaseAlert {
  ingredientId: string;
  name: string;
  date: IsoDate;
  /** Variación % del último precio contra la compra anterior del mismo proveedor. */
  pct: number;
}

/**
 * Insumos cuyo último precio de compra subió más de `thresholdPct` % contra la compra anterior (mismo proveedor)
 * en los últimos 30 días. Sólo trae porcentajes: se puede mostrar a quien no ve montos.
 */
export async function getPriceIncreases(
  db: Executor,
  today: IsoDate,
  thresholdPct: number,
): Promise<PriceIncreaseAlert[]> {
  const rows = await db.execute<{
    ingredient_id: string;
    name: string;
    date: string;
    price: number;
    prev_price: number;
  }>(sql`
    with ranked as (
      select p.ingredient_id, p.date, p.unit_price_net::float8 as price,
             lag(p.unit_price_net::float8) over (
               partition by p.ingredient_id, p.supplier_id order by p.date, p.created_at
             ) as prev_price,
             row_number() over (partition by p.ingredient_id order by p.date desc, p.created_at desc) as rn
      from ingredient_prices p
    )
    select r.ingredient_id, i.name, to_char(r.date, 'YYYY-MM-DD') as date, r.price, r.prev_price
    from ranked r
    join ingredients i on i.id = r.ingredient_id
    where r.rn = 1 and r.prev_price is not null and i.active
  `);
  return priceIncreases(
    [...rows].map((r) => ({
      ingredientId: r.ingredient_id,
      name: r.name,
      date: r.date,
      price: r.price,
      previousPrice: r.prev_price,
    })),
    today,
    { thresholdPct, days: PRICE_INCREASE_WINDOW_DAYS },
  ).map((s) => ({ ingredientId: s.ingredientId, name: s.name, date: s.date, pct: s.pct }));
}

// ------------------------------------------------------------------------------------------------
// Pedidos del próximo día hábil sin preparar
// ------------------------------------------------------------------------------------------------

export interface NextDayOrders {
  /** Próximo día hábil (mañana, salvo fin de semana o feriado de producción). */
  date: IsoDate;
  isTomorrow: boolean;
  /** Pedidos que todavía no están listos. */
  notReady: number;
  /** Pedidos listos pero sin ruta armada. */
  readyWithoutRoute: number;
  items: { number: number; customer: string; status: string }[];
}

/**
 * Pedidos con fecha comprometida el próximo día hábil que no están listos, o que están listos pero no están
 * en ninguna ruta (no cancelada). Los ya despachados, entregados o anulados no cuentan.
 */
export async function getNextDayOrders(
  db: Executor,
  today: IsoDate,
  workdays: number[],
): Promise<NextDayOrders> {
  const tomorrow = addDays(today, 1);
  const date = nextWorkdays(tomorrow, 1, workdays)[0]!;
  const o = schema.orders;
  const rows = await db
    .select({
      id: o.id,
      number: o.number,
      status: o.status,
      customer: schema.customers.legalName,
      routeStops: sql<number>`(
        select count(*)::int from ${schema.routeStops} rs
        join ${schema.routes} r on r.id = rs.route_id
        where rs.order_id = ${o.id} and r.status <> 'cancelled'
      )`,
    })
    .from(o)
    .innerJoin(schema.customers, eq(schema.customers.id, o.customerId))
    .where(
      and(
        eq(o.promisedDate, date),
        notInArray(o.status, ["dispatched", "delivered", "invoiced", "paid", "cancelled"]),
      ),
    )
    .orderBy(o.number);
  const pending = rows.filter((r) => r.status !== "ready" || r.routeStops === 0);
  return {
    date,
    isTomorrow: date === tomorrow,
    notReady: pending.filter((r) => r.status !== "ready").length,
    readyWithoutRoute: pending.filter((r) => r.status === "ready").length,
    items: pending.slice(0, 5).map((r) => ({ number: r.number, customer: r.customer, status: r.status })),
  };
}
