import {
  addMonths,
  preparedAvailable,
  roundMoney,
  roundQty,
  splitPreparedUnitsByLot,
  type IsoDate,
} from "@chipa/domain";
import { and, asc, eq, gte, inArray, isNull, lt, schema, sql, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import { TZ, todayAR, toIsoDateAR } from "@/lib/dates";
import { currentPriceMap } from "@/features/orders/service";
import { allocateProductFefo, locationByCode, recordProductMovements } from "@/features/stock/ledger";
import { getFinishedLotPositions } from "@/features/stock/service";
import { receiveResaleProducts } from "@/features/stock/resale";
import {
  STORE_METHODS,
  type CashClosingData,
  type ResaleReceiptData,
  type StoreMethod,
  type StoreSaleData,
  type VoidSaleData,
} from "./schemas";

/**
 * RF-33: ventas del local y cierre de caja. El local es un depósito más (ubicación LOCAL).
 * Se vende cualquier producto activo y disponible en el local:
 * - fabricado: descuenta su stock en LOCAL por lote FEFO;
 * - reventa (gaseosas…): descuenta su stock en LOCAL, que no tiene lote;
 * - elaborado: descuenta `baseQty × cantidad` de su producto base en LOCAL por lote FEFO
 *   (la línea de venta queda con el elaborado; el movimiento de stock, con el base).
 * Una venta anulada devuelve el stock (movimiento `return`) y no cuenta en ningún total.
 */

export const STORE_LOCATION = "LOCAL";
const AR_DATE = sql`(${schema.storeSales.soldAt} at time zone ${TZ})::date`;

/** Condición: ventas vigentes (no anuladas). Usarla en TODA consulta de ventas del local. */
export const activeSale = isNull(schema.storeSales.voidedAt);

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

/** Unidades vendibles por producto en el local (sin lotes retenidos por calidad). */
export async function localStockByProduct(db: Executor, locationId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      productId: schema.productStock.productId,
      qty: sql<number>`sum(greatest(${schema.productStock.qty}, 0))::float8`,
    })
    .from(schema.productStock)
    .leftJoin(schema.finishedLots, eq(schema.finishedLots.id, schema.productStock.finishedLotId))
    .where(
      and(
        eq(schema.productStock.locationId, locationId),
        sql`coalesce(${schema.finishedLots.onHold}, false) = false`,
      ),
    )
    .groupBy(schema.productStock.productId);
  return new Map(rows.map((r) => [r.productId, roundQty(Number(r.qty))]));
}

export interface StoreProduct {
  productId: string;
  code: string;
  name: string;
  kind: "manufactured" | "resale" | "prepared";
  unitLabel: string;
  barcode: string | null;
  /** Precio vigente de la lista del canal local. */
  price: number;
  /** Unidades que se pueden vender hoy (elaborado: las que alcanzan con el stock de su base). */
  stock: number;
  /** Producto cuyo stock se descuenta (el mismo, o el base de un elaborado). */
  poolId: string;
  /** Cuánto del stock del `poolId` consume cada unidad vendida (1; el elaborado, su `baseQty`). */
  consume: number;
}

/** Productos vendibles en el local (con precio en la lista del canal) y su stock en LOCAL. */
export async function getStoreCatalog(db: Executor, today: IsoDate = todayAR()) {
  const [location, listId] = await Promise.all([locationByCode(db, STORE_LOCATION), storePriceListId(db)]);
  const [products, stockBy] = await Promise.all([
    db.query.products.findMany({
      where: and(eq(schema.products.active, true), eq(schema.products.availableInStore, true)),
      orderBy: asc(schema.products.code),
    }),
    localStockByProduct(db, location.id),
  ]);
  const prices = listId ? ((await currentPriceMap(db, today, listId))[listId] ?? {}) : {};
  const poolStock: Record<string, number> = {};
  const items: StoreProduct[] = products
    .filter((p) => prices[p.id] != null)
    .map((p) => {
      const prepared = p.kind === "prepared" && p.baseProductId && p.baseQty ? p : null;
      const poolId = prepared ? prepared.baseProductId! : p.id;
      const consume = prepared ? prepared.baseQty! : 1;
      const pooled = stockBy.get(poolId) ?? 0;
      poolStock[poolId] = pooled;
      return {
        productId: p.id,
        code: p.code,
        name: p.name,
        kind: p.kind,
        unitLabel: p.unitLabel,
        barcode: p.barcode,
        price: prices[p.id]!,
        stock: prepared ? preparedAvailable(pooled, consume) : pooled,
        poolId,
        consume,
      };
    });
  return { locationId: location.id, priceListId: listId, products: items, poolStock };
}
export type StoreCatalog = Awaited<ReturnType<typeof getStoreCatalog>>;

export interface StoreCustomer {
  id: string;
  name: string;
  /** Precios de su lista (producto → precio) para los productos del local; vacío = usa los del mostrador. */
  prices: Record<string, number>;
}

/**
 * Clientes (mayoristas) que se pueden elegir al vender en el local, con los precios de su lista.
 * Se resuelve acá para que el local no necesite el permiso de clientes.
 */
export async function getStoreCustomers(db: Executor, today: IsoDate = todayAR()): Promise<StoreCustomer[]> {
  const [customers, prices] = await Promise.all([
    db.query.customers.findMany({
      where: and(eq(schema.customers.active, true)),
      orderBy: asc(schema.customers.legalName),
    }),
    currentPriceMap(db, today),
  ]);
  return customers
    .filter((c) => c.channel !== "store")
    .map((c) => ({
      id: c.id,
      name: c.tradeName ? `${c.tradeName} (${c.legalName})` : c.legalName,
      prices: c.priceListId ? (prices[c.priceListId] ?? {}) : {},
    }));
}

/** Stock del local por lote, con vencimiento (más próximo a vencer primero). */
export async function getStoreStock(db: Executor, today: IsoDate = todayAR()) {
  const positions = await getFinishedLotPositions(db, today);
  return positions.filter((p) => p.locationCode === STORE_LOCATION && p.qty > 0);
}

/** Proveedores activos para el ingreso de mercadería (el local no tiene el permiso de proveedores). */
export async function listStoreSuppliers(db: Executor) {
  const rows = await db.query.suppliers.findMany({
    where: eq(schema.suppliers.active, true),
    orderBy: asc(schema.suppliers.legalName),
  });
  return rows.map((s) => ({ id: s.id, name: s.tradeName ?? s.legalName }));
}

/** Productos de reventa del local (para ingresar mercadería). */
export async function listResaleProducts(db: Executor) {
  const rows = await db.query.products.findMany({
    where: and(eq(schema.products.active, true), eq(schema.products.kind, "resale")),
    orderBy: asc(schema.products.name),
  });
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    code: p.code,
    barcode: p.barcode,
    unitLabel: p.unitLabel,
  }));
}

/** Ingreso de mercadería de reventa en el local (lo que trae el proveedor): suma stock en LOCAL sin lote. */
export async function receiveStoreMerchandise(
  db: Executor,
  userId: string | null,
  input: ResaleReceiptData,
  today: IsoDate = todayAR(),
) {
  return receiveResaleProducts(db, userId, {
    items: input.items.map((i) => ({ productId: i.productId, qty: i.qty, unitCostNet: i.unitCostNet })),
    supplierId: input.supplierId,
    date: today,
    locationCode: STORE_LOCATION,
    refTable: "resale_receipt",
  });
}

// ------------------------------------------------------------------------------------------------
// Venta
// ------------------------------------------------------------------------------------------------

interface PlanLine {
  productId: string;
  name: string;
  kind: "manufactured" | "resale" | "prepared";
  units: number;
  price: number;
  poolId: string;
  consume: number;
  baseQty: number | null;
}

/** Saldo de un producto de reventa en el local (no tiene lotes). */
async function resaleBalance(db: Executor, productId: string, locationId: string): Promise<number> {
  const rows = await db
    .select({ qty: sql<number>`coalesce(sum(${schema.productStock.qty}), 0)::float8` })
    .from(schema.productStock)
    .where(and(eq(schema.productStock.productId, productId), eq(schema.productStock.locationId, locationId)));
  return roundQty(Number(rows[0]?.qty ?? 0));
}

const unitsText = (n: number) => String(roundQty(n)).replace(".", ",");

/**
 * Registra una venta: precio de la lista del local (o la del cliente mayorista), stock descontado del LOCAL
 * (por lote FEFO si el producto tiene lotes) y uno o dos pagos. Si algún producto no tiene stock suficiente
 * en el local no se registra nada.
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
  const prices = (await currentPriceMap(db, today))[listId] ?? {};
  let customerPrices: Record<string, number> = {};
  if (input.customerId) {
    const customer = await db.query.customers.findFirst({
      where: eq(schema.customers.id, input.customerId),
    });
    if (!customer) throw new UserError("El cliente no existe.");
    if (customer.priceListId)
      customerPrices = (await currentPriceMap(db, today, customer.priceListId))[customer.priceListId] ?? {};
  }

  const merged = new Map<string, number>();
  for (const i of input.items) merged.set(i.productId, (merged.get(i.productId) ?? 0) + i.qtyUnits);
  const products = await db.query.products.findMany({
    where: inArray(schema.products.id, [...merged.keys()]),
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  // 1) Validar líneas y precios.
  const lines: PlanLine[] = [];
  for (const [productId, units] of merged) {
    const product = byId.get(productId);
    if (!product) throw new UserError("Uno de los productos no existe.");
    if (!product.active || !product.availableInStore)
      throw new UserError(`${product.name} no está disponible para vender en el local.`);
    const price = customerPrices[productId] ?? prices[productId];
    if (price == null) throw new UserError(`${product.name} no tiene precio en la lista del local.`);
    let poolId = product.id;
    let consume = 1;
    let baseQty: number | null = null;
    if (product.kind === "prepared") {
      if (!product.baseProductId || !product.baseQty)
        throw new UserError(`${product.name} no tiene definido el producto del que se elabora.`);
      poolId = product.baseProductId;
      consume = product.baseQty;
      baseQty = product.baseQty;
    }
    lines.push({ productId, name: product.name, kind: product.kind, units, price, poolId, consume, baseQty });
  }

  // 2) Asignar stock por "pool" (un producto con lotes o de reventa): un elaborado y su base comparten stock.
  const poolIds = [...new Set(lines.map((l) => l.poolId))];
  const poolProducts = await db.query.products.findMany({ where: inArray(schema.products.id, poolIds) });
  const poolById = new Map(poolProducts.map((p) => [p.id, p]));
  type Slice = { finishedLotId: string | null; qty: number };
  const sliceByLine = new Map<string, Slice[]>();
  for (const poolId of poolIds) {
    const pool = poolById.get(poolId)!;
    const poolLines = lines.filter((l) => l.poolId === poolId);
    const needed = roundQty(poolLines.reduce((a, l) => a + l.units * l.consume, 0));
    let slices: Slice[];
    let available: number;
    if (pool.kind === "resale") {
      available = await resaleBalance(db, poolId, location.id);
      slices = [{ finishedLotId: null, qty: needed }];
    } else {
      const { allocations, shortfall } = await allocateProductFefo(db, poolId, needed, {
        locationIds: [location.id],
        allowShortfall: true,
      });
      available = roundQty(needed - shortfall);
      slices = allocations.map((a) => ({ finishedLotId: a.finishedLotId as string | null, qty: a.qty }));
    }
    if (available + 1e-9 < needed) {
      const prepared = poolLines.find((l) => l.kind === "prepared");
      const hint =
        pool.kind === "resale"
          ? " Ingresá la mercadería en Local › Ingreso de mercadería."
          : " Pedí reposición a la planta (Local › Alertas).";
      if (prepared) {
        const maxUnits = preparedAvailable(available, prepared.consume);
        throw new UserError(
          `No hay stock suficiente para ${prepared.name}: se elabora con ${pool.name} y en el local ` +
            `hay ${unitsText(available)} (alcanza para ${maxUnits}).${hint}`,
        );
      }
      throw new UserError(
        available > 0
          ? `No hay stock suficiente de ${pool.name} en el local: hay ${unitsText(available)} y pediste ${unitsText(needed)}.`
          : `No hay stock de ${pool.name} en el local.${hint}`,
      );
    }
    // Repartir lo asignado entre las líneas del pool, en orden.
    const cursor = slices.map((s) => ({ ...s }));
    for (const l of poolLines) {
      let need = roundQty(l.units * l.consume);
      const taken: Slice[] = [];
      for (const s of cursor) {
        if (need <= 0) break;
        const take = Math.min(s.qty, need);
        if (take <= 0) continue;
        taken.push({ finishedLotId: s.finishedLotId, qty: roundQty(take) });
        s.qty = roundQty(s.qty - take);
        need = roundQty(need - take);
      }
      sliceByLine.set(l.productId, taken);
    }
  }

  // 3) Pagos.
  const total = roundMoney(lines.reduce((a, l) => a + l.price * l.units, 0));
  const payments = input.payments.map((p) => ({ method: p.method, amount: p.amount }));
  if (payments.length === 1) {
    const only = payments[0]!;
    if (only.amount != null && Math.abs(only.amount - total) > 0.005)
      throw new UserError(`El pago no coincide con el total de la venta (${total}).`);
  } else {
    const sum = roundMoney(payments.reduce((a, p) => a + (p.amount ?? 0), 0));
    if (Math.abs(sum - total) > 0.005)
      throw new UserError(`Los pagos suman ${sum} y el total de la venta es ${total}. Revisá los montos.`);
  }
  const finalPayments = payments.map((p) => ({ method: p.method, amount: p.amount ?? total }));
  const primary = [...finalPayments].sort((a, b) => b.amount - a.amount)[0]!;

  // 4) Escribir la venta, sus pagos, sus ítems por lote y los movimientos de stock.
  const soldAt = soldAtFor(today, now);
  const [sale] = await db
    .insert(schema.storeSales)
    .values({
      soldAt,
      locationId: location.id,
      customerId: input.customerId ?? null,
      method: primary.method,
      total,
      sellerId: userId,
    })
    .returning();
  await db
    .insert(schema.storeSalePayments)
    .values(finalPayments.map((p) => ({ saleId: sale!.id, method: p.method, amount: p.amount })));
  const itemRows: (typeof schema.storeSaleItems.$inferInsert)[] = [];
  const moves: Parameters<typeof recordProductMovements>[2] = [];
  for (const l of lines) {
    const slices = sliceByLine.get(l.productId)!;
    const perLot: { finishedLotId: string | null; units: number }[] =
      l.kind === "prepared"
        ? splitPreparedUnitsByLot(
            l.units,
            l.baseQty!,
            slices.map((s) => ({ lotId: s.finishedLotId ?? "", qty: s.qty })),
          ).map((x) => ({ finishedLotId: x.lotId || null, units: x.units }))
        : slices.map((s) => ({ finishedLotId: s.finishedLotId, units: s.qty }));
    for (const x of perLot)
      itemRows.push({
        saleId: sale!.id,
        productId: l.productId,
        finishedLotId: x.finishedLotId,
        qtyUnits: x.units,
        unitPrice: l.price,
      });
    for (const s of slices)
      moves.push({
        type: "store_sale",
        productId: l.poolId,
        finishedLotId: s.finishedLotId,
        locationId: location.id,
        qty: -s.qty,
        refTable: "store_sales",
        refId: sale!.id,
        note: l.kind === "prepared" ? `${l.name} (consume ${unitsText(l.consume)} por unidad)` : null,
        occurredAt: soldAt,
      });
  }
  await db.insert(schema.storeSaleItems).values(itemRows);
  await recordProductMovements(db, userId, moves);
  return { sale: sale!, total, units: lines.reduce((a, l) => a + l.units, 0) };
}

// ------------------------------------------------------------------------------------------------
// Anulación
// ------------------------------------------------------------------------------------------------

/**
 * Anula una venta cargada por error: motivo obligatorio, devuelve el stock al mismo lote/producto con
 * movimientos `return` y deja la venta marcada (no se borra). Las anuladas no cuentan en ventas, cierre de
 * caja, resultado ni demanda.
 * Quien no es Dirección (`anyDay = false`) solo puede anular ventas de hoy mientras la caja de hoy no esté cerrada.
 */
export async function voidStoreSale(
  db: Executor,
  userId: string | null,
  input: VoidSaleData,
  opts: { anyDay: boolean; today?: IsoDate } = { anyDay: false },
) {
  const today = opts.today ?? todayAR();
  const sale = await db.query.storeSales.findFirst({ where: eq(schema.storeSales.id, input.saleId) });
  if (!sale) throw new UserError("La venta no existe.");
  if (sale.voidedAt) throw new UserError("Esa venta ya está anulada.");
  const saleDay = toIsoDateAR(sale.soldAt);
  if (!opts.anyDay) {
    if (saleDay !== today)
      throw new UserError(
        "Solo se pueden anular ventas de hoy. Para una venta anterior, avisale a Dirección.",
      );
    const closing = await db.query.cashClosings.findFirst({
      where: and(eq(schema.cashClosings.date, saleDay), eq(schema.cashClosings.locationId, sale.locationId)),
    });
    if (closing)
      throw new UserError("La caja de hoy ya está cerrada: la venta solo la puede anular Dirección.");
  }
  const sold = await db.query.stockMovements.findMany({
    where: and(
      eq(schema.stockMovements.refTable, "store_sales"),
      eq(schema.stockMovements.refId, sale.id),
      eq(schema.stockMovements.type, "store_sale"),
    ),
  });
  const [updated] = await db
    .update(schema.storeSales)
    .set({ voidedAt: new Date(), voidedById: userId, voidReason: input.reason })
    .where(and(eq(schema.storeSales.id, sale.id), isNull(schema.storeSales.voidedAt)))
    .returning();
  if (!updated) throw new UserError("Esa venta ya está anulada.");
  await recordProductMovements(
    db,
    userId,
    sold.map((m) => ({
      type: "return" as const,
      productId: m.productId!,
      finishedLotId: m.finishedLotId,
      locationId: m.locationId,
      qty: -m.qty,
      refTable: "store_sales",
      refId: sale.id,
      note: `Anulación de venta: ${input.reason}`,
    })),
  );
  return { sale: updated, returnedUnits: roundQty(sold.reduce((a, m) => a - m.qty, 0)) };
}

// ------------------------------------------------------------------------------------------------
// Historial y cierre de caja
// ------------------------------------------------------------------------------------------------

/** Ventas del local de un día (también las anuladas, marcadas) con sus ítems y pagos. */
export async function listSalesOfDay(db: Executor, date: IsoDate) {
  const location = await locationByCode(db, STORE_LOCATION);
  return db.query.storeSales.findMany({
    where: and(onDay(date), eq(schema.storeSales.locationId, location.id)),
    with: {
      items: { with: { product: true } },
      payments: true,
      seller: true,
      customer: true,
      voidedBy: true,
    },
    orderBy: asc(schema.storeSales.soldAt),
  });
}

export type MethodTotals = Record<StoreMethod, number>;
const emptyMethods = (): MethodTotals => ({ cash: 0, transfer: 0, card: 0, qr: 0 });

/** Totales por medio de pago de ventas vigentes (cada una con sus pagos). */
function totalsByMethod(
  sales: { voidedAt: Date | null; payments: { method: string; amount: number }[] }[],
): MethodTotals {
  const out = emptyMethods();
  for (const s of sales) {
    if (s.voidedAt) continue;
    for (const p of s.payments) if (p.method in out) out[p.method as StoreMethod] += p.amount;
  }
  for (const m of STORE_METHODS) out[m] = roundMoney(out[m]);
  return out;
}

function summarize(byMethod: MethodTotals, count: number) {
  const electronic = roundMoney(byMethod.transfer + byMethod.card + byMethod.qr);
  return {
    byMethod,
    cash: byMethod.cash,
    electronic,
    total: roundMoney(byMethod.cash + electronic),
    count,
  };
}

/** Ventas del día, totales por medio de pago y su cierre de caja (si ya se cerró). Las anuladas no suman. */
export async function getDaySummary(db: Executor, date: IsoDate) {
  const [sales, location] = await Promise.all([listSalesOfDay(db, date), locationByCode(db, STORE_LOCATION)]);
  const closing = await db.query.cashClosings.findFirst({
    where: and(eq(schema.cashClosings.date, date), eq(schema.cashClosings.locationId, location.id)),
    with: { closedBy: true },
  });
  const active = sales.filter((s) => !s.voidedAt);
  const totals = summarize(totalsByMethod(sales), active.length);
  const units = active.reduce((a, s) => a + s.items.reduce((x, i) => x + i.qtyUnits, 0), 0);
  const differs = (a: number, b: number) => Math.abs(a - b) > 0.005;
  return {
    date,
    sales,
    totals: { ...totals, units },
    voidedCount: sales.length - active.length,
    closing: closing
      ? {
          ...closing,
          difference: roundMoney(closing.countedCash - closing.expectedCash),
          /** Hubo ventas (o anulaciones) después de cerrar la caja. */
          stale:
            differs(closing.expectedCash, totals.byMethod.cash) ||
            differs(closing.expectedTransfer, totals.byMethod.transfer) ||
            differs(closing.expectedCard, totals.byMethod.card) ||
            differs(closing.expectedQr, totals.byMethod.qr),
        }
      : null,
  };
}
export type DaySummary = Awaited<ReturnType<typeof getDaySummary>>;

/**
 * Cierre de caja diario: efectivo esperado = ventas en efectivo del día (sin anuladas); la diferencia es
 * contado − esperado. Uno por día (índice único). Transferencia, tarjeta y QR quedan registradas como
 * información para conciliar contra el banco y el procesador de pagos.
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
      expectedCash: day.totals.byMethod.cash,
      countedCash: input.countedCash,
      expectedTransfer: day.totals.byMethod.transfer,
      expectedCard: day.totals.byMethod.card,
      expectedQr: day.totals.byMethod.qr,
      closedById: userId,
      notes: input.notes,
    })
    .returning();
  return { closing: closing!, difference: roundMoney(input.countedCash - day.totals.byMethod.cash) };
}

/** Ventas y cierres del mes, día por día (sin anuladas). */
export async function getMonthSummary(db: Executor, month: string) {
  const from = `${month}-01`;
  const to = addMonths(from, 1);
  const location = await locationByCode(db, STORE_LOCATION);
  const range = and(
    eq(schema.storeSales.locationId, location.id),
    sql`${AR_DATE} >= ${from}::date`,
    sql`${AR_DATE} < ${to}::date`,
    activeSale,
  );
  const [sales, payments, closings] = await Promise.all([
    db
      .select({ id: schema.storeSales.id, soldAt: schema.storeSales.soldAt })
      .from(schema.storeSales)
      .where(range),
    db
      .select({
        soldAt: schema.storeSales.soldAt,
        method: schema.storeSalePayments.method,
        amount: schema.storeSalePayments.amount,
      })
      .from(schema.storeSalePayments)
      .innerJoin(schema.storeSales, eq(schema.storeSales.id, schema.storeSalePayments.saleId))
      .where(range),
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
  const countByDay = new Map<string, number>();
  for (const s of sales) {
    const d = toIsoDateAR(s.soldAt);
    countByDay.set(d, (countByDay.get(d) ?? 0) + 1);
  }
  const methodsByDay = new Map<string, MethodTotals>();
  const monthMethods = emptyMethods();
  for (const p of payments) {
    const d = toIsoDateAR(p.soldAt);
    const cur = methodsByDay.get(d) ?? emptyMethods();
    cur[p.method as StoreMethod] += p.amount;
    monthMethods[p.method as StoreMethod] += p.amount;
    methodsByDay.set(d, cur);
  }
  const rounded = (m: MethodTotals): MethodTotals => ({
    cash: roundMoney(m.cash),
    transfer: roundMoney(m.transfer),
    card: roundMoney(m.card),
    qr: roundMoney(m.qr),
  });
  const closingBy = new Map(closings.map((c) => [c.date, c]));
  const days = [...new Set([...countByDay.keys(), ...closingBy.keys()])].sort().map((date) => {
    const t = summarize(rounded(methodsByDay.get(date) ?? emptyMethods()), countByDay.get(date) ?? 0);
    const c = closingBy.get(date);
    return { date, ...t, closed: !!c, difference: c ? roundMoney(c.countedCash - c.expectedCash) : null };
  });
  return { month, days, totals: summarize(rounded(monthMethods), sales.length) };
}
export type MonthSummary = Awaited<ReturnType<typeof getMonthSummary>>;
