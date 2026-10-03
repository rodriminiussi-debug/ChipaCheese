import { addMonths, roundMoney, roundQty, type IsoDate } from "@chipa/domain";
import { and, asc, eq, gte, inArray, lt, schema, sql, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import { TZ, todayAR, toIsoDateAR } from "@/lib/dates";
import { currentPriceMap } from "@/features/orders/service";
import { allocateProductFefo, locationByCode, recordProductMovements } from "@/features/stock/ledger";
import { getFinishedLotPositions } from "@/features/stock/service";
import type { CashClosingData, StoreSaleData } from "./schemas";

/**
 * RF-33: ventas del local y cierre de caja. El local es un depósito más (ubicación LOCAL): cada venta
 * descuenta stock por lote FEFO desde ahí con un movimiento `store_sale` negativo.
 */

export const STORE_LOCATION = "LOCAL";
const AR_DATE = sql`(${schema.storeSales.soldAt} at time zone ${TZ})::date`;

/** Instante de la venta coherente con el día de negocio (en tests el día está congelado). */
function soldAtFor(today: IsoDate, real: Date = new Date()): Date {
  if (toIsoDateAR(real) === today) return real;
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(real);
  return new Date(`${today}T${time}-03:00`);
}

const onDay = (date: IsoDate) => sql`${AR_DATE} = ${date}::date`;

async function storePriceListId(db: Executor): Promise<string | null> {
  const pl = schema.priceLists;
  const [row] = await db
    .select({ id: pl.id })
    .from(pl)
    .where(and(eq(pl.active, true), eq(pl.channel, "store")))
    .orderBy(asc(pl.name))
    .limit(1);
  return row?.id ?? null;
}

export interface StoreProduct {
  productId: string;
  code: string;
  name: string;
  netWeightKg: number;
  /** Precio vigente de la lista del canal local. */
  price: number;
  /** Unidades en la ubicación LOCAL. */
  stock: number;
}

/** Productos vendibles en el local (con precio en la lista del canal) y su stock en LOCAL. */
export async function getStoreCatalog(db: Executor, today: IsoDate = todayAR()) {
  const [location, listId] = await Promise.all([locationByCode(db, STORE_LOCATION), storePriceListId(db)]);
  const [products, stock] = await Promise.all([
    db.query.products.findMany({
      where: eq(schema.products.active, true),
      orderBy: asc(schema.products.code),
    }),
    db
      .select({
        productId: schema.productStock.productId,
        qty: sql<number>`sum(${schema.productStock.qty})::float8`,
      })
      .from(schema.productStock)
      .where(eq(schema.productStock.locationId, location.id))
      .groupBy(schema.productStock.productId),
  ]);
  const prices = listId ? ((await currentPriceMap(db, today, listId))[listId] ?? {}) : {};
  const stockBy = new Map(stock.map((s) => [s.productId, roundQty(Number(s.qty))]));
  const items: StoreProduct[] = products
    .filter((p) => prices[p.id] != null)
    .map((p) => ({
      productId: p.id,
      code: p.code,
      name: p.name,
      netWeightKg: p.netWeightKg,
      price: prices[p.id]!,
      stock: stockBy.get(p.id) ?? 0,
    }));
  return { locationId: location.id, priceListId: listId, products: items };
}
export type StoreCatalog = Awaited<ReturnType<typeof getStoreCatalog>>;

/** Stock del local por lote, con vencimiento (más próximo a vencer primero). */
export async function getStoreStock(db: Executor, today: IsoDate = todayAR()) {
  const positions = await getFinishedLotPositions(db, today);
  return positions.filter((p) => p.locationCode === STORE_LOCATION && p.qty > 0);
}

/**
 * Registra una venta: precio de la lista del local, stock descontado por lote FEFO desde LOCAL.
 * Si algún producto no tiene stock suficiente en el local no se registra nada.
 */
export async function createStoreSale(
  db: Executor,
  userId: string | null,
  input: StoreSaleData,
  today: IsoDate = todayAR(),
  now: Date = new Date(),
) {
  const [location, listId] = await Promise.all([locationByCode(db, STORE_LOCATION), storePriceListId(db)]);
  if (!listId) throw new UserError("No hay una lista de precios activa para el local.");
  const prices = (await currentPriceMap(db, today, listId))[listId] ?? {};

  const merged = new Map<string, number>();
  for (const i of input.items) merged.set(i.productId, (merged.get(i.productId) ?? 0) + i.qtyUnits);
  const products = await db.query.products.findMany({
    where: inArray(schema.products.id, [...merged.keys()]),
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  // 1) Validar y asignar lotes de todos los ítems antes de escribir.
  const plan: {
    productId: string;
    price: number;
    allocations: { finishedLotId: string; qty: number }[];
  }[] = [];
  for (const [productId, units] of merged) {
    const product = byId.get(productId);
    if (!product) throw new UserError("Uno de los productos no existe.");
    const price = prices[productId];
    if (price == null) throw new UserError(`${product.name} no tiene precio en la lista del local.`);
    const { allocations, shortfall } = await allocateProductFefo(db, productId, units, {
      locationIds: [location.id],
      allowShortfall: true,
    });
    if (shortfall > 0) {
      const available = units - shortfall;
      throw new UserError(
        available > 0
          ? `No hay stock suficiente de ${product.name} en el local: hay ${available} y pediste ${units}.`
          : `No hay stock de ${product.name} en el local. Transferí producto desde F3 o F4 (Stock › Producto terminado).`,
      );
    }
    plan.push({
      productId,
      price,
      allocations: allocations.map((a) => ({ finishedLotId: a.finishedLotId, qty: a.qty })),
    });
  }

  // 2) Escribir la venta, sus ítems por lote y los movimientos de stock.
  const total = roundMoney(
    plan.reduce((a, p) => a + p.price * p.allocations.reduce((s, x) => s + x.qty, 0), 0),
  );
  const soldAt = soldAtFor(today, now);
  const [sale] = await db
    .insert(schema.storeSales)
    .values({ soldAt, locationId: location.id, method: input.method, total, sellerId: userId })
    .returning();
  await db.insert(schema.storeSaleItems).values(
    plan.flatMap((p) =>
      p.allocations.map((a) => ({
        saleId: sale!.id,
        productId: p.productId,
        finishedLotId: a.finishedLotId,
        qtyUnits: a.qty,
        unitPrice: p.price,
      })),
    ),
  );
  await recordProductMovements(
    db,
    userId,
    plan.flatMap((p) =>
      p.allocations.map((a) => ({
        type: "store_sale" as const,
        productId: p.productId,
        finishedLotId: a.finishedLotId,
        locationId: location.id,
        qty: -a.qty,
        refTable: "store_sales",
        refId: sale!.id,
        occurredAt: soldAt,
      })),
    ),
  );
  return {
    sale: sale!,
    total,
    units: plan.reduce((a, p) => a + p.allocations.reduce((s, x) => s + x.qty, 0), 0),
  };
}

// ------------------------------------------------------------------------------------------------
// Historial y cierre de caja
// ------------------------------------------------------------------------------------------------

/** Ventas del local de un día con sus ítems. */
export async function listSalesOfDay(db: Executor, date: IsoDate) {
  const location = await locationByCode(db, STORE_LOCATION);
  return db.query.storeSales.findMany({
    where: and(onDay(date), eq(schema.storeSales.locationId, location.id)),
    with: { items: { with: { product: true } }, seller: true },
    orderBy: asc(schema.storeSales.soldAt),
  });
}

function splitByMethod(sales: { method: string; total: number }[]) {
  const cash = roundMoney(sales.filter((s) => s.method === "cash").reduce((a, s) => a + s.total, 0));
  const electronic = roundMoney(sales.filter((s) => s.method !== "cash").reduce((a, s) => a + s.total, 0));
  return { cash, electronic, total: roundMoney(cash + electronic), count: sales.length };
}

/** Ventas del día, totales por medio de pago y su cierre de caja (si ya se cerró). */
export async function getDaySummary(db: Executor, date: IsoDate) {
  const [sales, location] = await Promise.all([listSalesOfDay(db, date), locationByCode(db, STORE_LOCATION)]);
  const closing = await db.query.cashClosings.findFirst({
    where: and(eq(schema.cashClosings.date, date), eq(schema.cashClosings.locationId, location.id)),
    with: { closedBy: true },
  });
  const totals = splitByMethod(sales);
  const units = sales.reduce((a, s) => a + s.items.reduce((x, i) => x + i.qtyUnits, 0), 0);
  return {
    date,
    sales,
    totals: { ...totals, units },
    closing: closing
      ? {
          ...closing,
          difference: roundMoney(closing.countedCash - closing.expectedCash),
          /** Hubo ventas después de cerrar la caja. */
          stale:
            Math.abs(closing.expectedCash - totals.cash) > 0.005 ||
            Math.abs(closing.expectedTransfer - totals.electronic) > 0.005,
        }
      : null,
  };
}
export type DaySummary = Awaited<ReturnType<typeof getDaySummary>>;

/**
 * Cierre de caja diario: efectivo esperado = ventas en efectivo del día; la diferencia es contado − esperado.
 * Uno por día (índice único); las transferencias quedan registradas para conciliar contra el banco.
 */
export async function closeCash(
  db: Executor,
  userId: string | null,
  input: CashClosingData,
  today: IsoDate = todayAR(),
) {
  const date = input.date ?? today;
  if (date > today) throw new UserError("No se puede cerrar la caja de un día futuro.");
  const day = await getDaySummary(db, date);
  if (day.closing) throw new UserError("La caja de ese día ya está cerrada.");
  const location = await locationByCode(db, STORE_LOCATION);
  const [closing] = await db
    .insert(schema.cashClosings)
    .values({
      date,
      locationId: location.id,
      expectedCash: day.totals.cash,
      countedCash: input.countedCash,
      expectedTransfer: day.totals.electronic,
      closedById: userId,
      notes: input.notes,
    })
    .returning();
  return { closing: closing!, difference: roundMoney(input.countedCash - day.totals.cash) };
}

/** Ventas y cierres del mes, día por día. */
export async function getMonthSummary(db: Executor, month: string) {
  const from = `${month}-01`;
  const to = addMonths(from, 1);
  const location = await locationByCode(db, STORE_LOCATION);
  const [sales, closings] = await Promise.all([
    db
      .select({
        soldAt: schema.storeSales.soldAt,
        method: schema.storeSales.method,
        total: schema.storeSales.total,
      })
      .from(schema.storeSales)
      .where(
        and(
          eq(schema.storeSales.locationId, location.id),
          sql`${AR_DATE} >= ${from}::date`,
          sql`${AR_DATE} < ${to}::date`,
        ),
      ),
    db
      .select()
      .from(schema.cashClosings)
      .where(
        and(
          eq(schema.cashClosings.locationId, location.id),
          gte(schema.cashClosings.date, from),
          lt(schema.cashClosings.date, to),
        ),
      ),
  ]);
  const byDay = new Map<string, { method: string; total: number }[]>();
  for (const s of sales) {
    const d = toIsoDateAR(s.soldAt);
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(s);
  }
  const closingBy = new Map(closings.map((c) => [c.date, c]));
  const days = [...new Set([...byDay.keys(), ...closingBy.keys()])].sort().map((date) => {
    const t = splitByMethod(byDay.get(date) ?? []);
    const c = closingBy.get(date);
    return {
      date,
      ...t,
      closed: !!c,
      difference: c ? roundMoney(c.countedCash - c.expectedCash) : null,
    };
  });
  return { month, days, totals: splitByMethod(sales) };
}
export type MonthSummary = Awaited<ReturnType<typeof getMonthSummary>>;
