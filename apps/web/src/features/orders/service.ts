import {
  addDays,
  allocateBacklogKg,
  averageOrderIntervalDays,
  canTransition,
  currentUnitPrice,
  daysSinceLastOrder,
  estimateBigOrderDate,
  isCustomerOverdue,
  isOrderEditable,
  isOrderOverdue,
  nextDeliveryDate,
  OPEN_ORDER_STATUSES,
  orderKg,
  orderTotal,
  roundMoney,
  roundQty,
  type IsoDate,
  type OrderStatus,
} from "@chipa/domain";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  ne,
  notInArray,
  schema,
  sql,
  type Executor,
} from "@chipa/db";
import { UserError } from "@/server/errors";
import { getSetting } from "@/server/settings";
import { toIsoDateAR, todayAR } from "@/lib/dates";
import { ORDER_STATUS } from "@/lib/labels";
import type { CreateOrderData, OrderFilters, UpdateOrderData } from "./schemas";

/**
 * Servicio de pedidos (M1: RF-02 a RF-05). Las funciones reciben un `Executor` (db o tx) y
 * `today` explícito donde importa la fecha, para poder testearse con transacciones revertidas.
 */

const FINISHED_DELIVERY: OrderStatus[] = ["delivered", "invoiced", "paid", "cancelled"];

type Item = { productId: string; qtyUnits: number };

/** Suma las líneas repetidas del mismo producto. */
function mergeItems(items: Item[]): Item[] {
  const byProduct = new Map<string, number>();
  for (const i of items) byProduct.set(i.productId, (byProduct.get(i.productId) ?? 0) + i.qtyUnits);
  return [...byProduct].map(([productId, qtyUnits]) => ({ productId, qtyUnits }));
}

// ------------------------------------------------------------------------------------------------
// Precios
// ------------------------------------------------------------------------------------------------

/** Precios vigentes a `today`: { [listaId]: { [productoId]: precio } } (último validFrom ≤ hoy). */
export async function currentPriceMap(
  db: Executor,
  today: IsoDate,
  priceListId?: string,
): Promise<Record<string, Record<string, number>>> {
  const p = schema.priceListItems;
  const rows = await db
    .select({ listId: p.priceListId, productId: p.productId, validFrom: p.validFrom, unitPrice: p.unitPrice })
    .from(p)
    .where(and(lte(p.validFrom, today), priceListId ? eq(p.priceListId, priceListId) : undefined));
  const grouped = new Map<string, { validFrom: IsoDate; unitPrice: number }[]>();
  for (const r of rows) {
    const key = `${r.listId}|${r.productId}`;
    (grouped.get(key) ?? grouped.set(key, []).get(key)!).push(r);
  }
  const out: Record<string, Record<string, number>> = {};
  for (const [key, prices] of grouped) {
    const [listId, productId] = key.split("|") as [string, string];
    const price = currentUnitPrice(prices, today);
    if (price != null) (out[listId] ??= {})[productId] = price;
  }
  return out;
}

/** Lista de precios del cliente; si no tiene, la primera activa de su canal. */
async function resolvePriceList(db: Executor, customer: { priceListId: string | null; channel: string }) {
  if (customer.priceListId) return customer.priceListId;
  const pl = schema.priceLists;
  const [byChannel] = await db
    .select({ id: pl.id })
    .from(pl)
    .where(
      and(eq(pl.active, true), eq(pl.channel, customer.channel as (typeof pl.channel.enumValues)[number])),
    )
    .orderBy(asc(pl.name))
    .limit(1);
  return byChannel?.id ?? null;
}

// ------------------------------------------------------------------------------------------------
// Stock terminado y demanda (base de RF-05)
// ------------------------------------------------------------------------------------------------

/** Stock de producto terminado en unidades, sumando todas las ubicaciones (vista v_product_stock). */
export async function finishedStockUnits(db: Executor): Promise<Record<string, number>> {
  const v = schema.productStock;
  const rows = await db
    .select({ productId: v.productId, qty: sql<number>`sum(${v.qty})::float8` })
    .from(v)
    .groupBy(v.productId);
  return Object.fromEntries(rows.map((r) => [r.productId, Number(r.qty)]));
}

/** Unidades pedidas por producto en pedidos abiertos (aún con producto en depósito o por producir). */
async function openOrderDemandUnits(db: Executor, excludeOrderId?: string | null) {
  const o = schema.orders;
  const i = schema.orderItems;
  const rows = await db
    .select({ productId: i.productId, units: sql<number>`sum(${i.qtyUnits})::float8` })
    .from(i)
    .innerJoin(o, eq(o.id, i.orderId))
    .where(
      and(inArray(o.status, [...OPEN_ORDER_STATUSES]), excludeOrderId ? ne(o.id, excludeOrderId) : undefined),
    )
    .groupBy(i.productId);
  return Object.fromEntries(rows.map((r) => [r.productId, Number(r.units)]));
}

/** Stock libre por producto = stock terminado − lo reservado por otros pedidos abiertos (≥ 0). */
export async function availableFinishedUnits(db: Executor, excludeOrderId?: string | null) {
  const [stock, reserved] = await Promise.all([
    finishedStockUnits(db),
    openOrderDemandUnits(db, excludeOrderId),
  ]);
  const free: Record<string, number> = {};
  for (const id of new Set([...Object.keys(stock), ...Object.keys(reserved)])) {
    free[id] = Math.max(0, (stock[id] ?? 0) - (reserved[id] ?? 0));
  }
  return { stock, reserved, free };
}

// ------------------------------------------------------------------------------------------------
// RF-02: formulario de carga
// ------------------------------------------------------------------------------------------------

/** Datos para el formulario de carga rápida: clientes, productos, precios vigentes y stock libre. */
export async function orderFormData(db: Executor, today: IsoDate = todayAR()) {
  const [customers, products, prices, avail] = await Promise.all([
    db.query.customers.findMany({
      where: eq(schema.customers.active, true),
      orderBy: asc(schema.customers.legalName),
      with: { zone: true },
    }),
    db.query.products.findMany({
      where: eq(schema.products.active, true),
      orderBy: [asc(schema.products.presentation), asc(schema.products.name)],
    }),
    currentPriceMap(db, today),
    availableFinishedUnits(db),
  ]);

  // Últimos ítems de cada cliente ("repetir último pedido").
  const o = schema.orders;
  const lastOrders = await db
    .selectDistinctOn([o.customerId], { id: o.id, customerId: o.customerId })
    .from(o)
    .where(ne(o.status, "cancelled"))
    .orderBy(o.customerId, desc(o.receivedAt));
  const lastItems = lastOrders.length
    ? await db
        .select({
          orderId: schema.orderItems.orderId,
          productId: schema.orderItems.productId,
          qtyUnits: schema.orderItems.qtyUnits,
        })
        .from(schema.orderItems)
        .where(
          inArray(
            schema.orderItems.orderId,
            lastOrders.map((l) => l.id),
          ),
        )
    : [];
  const itemsByOrder = new Map<string, Item[]>();
  for (const li of lastItems)
    (itemsByOrder.get(li.orderId) ?? itemsByOrder.set(li.orderId, []).get(li.orderId)!).push(li);
  const lastByCustomer = new Map(lastOrders.map((l) => [l.customerId, itemsByOrder.get(l.id) ?? []]));

  const priceListIds = await Promise.all(
    customers.map(async (c) => [c.id, await resolvePriceList(db, c)] as const),
  );
  const listByCustomer = new Map(priceListIds);

  return {
    today,
    customers: customers.map((c) => {
      const weekdays = c.deliveryWeekdays.length ? c.deliveryWeekdays : (c.zone?.deliveryWeekdays ?? []);
      return {
        id: c.id,
        name: c.legalName,
        tradeName: c.tradeName,
        channel: c.channel,
        zone: c.zone?.name ?? null,
        priceListId: listByCustomer.get(c.id) ?? null,
        deliveryWeekdays: weekdays,
        defaultPromisedDate: nextDeliveryDate({ today, weekdays }),
        lastItems: lastByCustomer.get(c.id) ?? [],
      };
    }),
    products: products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      shape: p.shape,
      presentation: p.presentation,
      netWeightKg: p.netWeightKg,
    })),
    prices,
    freeStockUnits: avail.free,
  };
}
export type OrderFormData = Awaited<ReturnType<typeof orderFormData>>;

/** RF-02: crea el pedido con precios congelados de la lista del cliente, total y evento "recibido". */
export async function createOrder(
  db: Executor,
  userId: string | null,
  input: CreateOrderData,
  opts: { today?: IsoDate } = {},
) {
  const today = opts.today ?? todayAR();
  const customer = await db.query.customers.findFirst({ where: eq(schema.customers.id, input.customerId) });
  if (!customer) throw new UserError("El cliente no existe.", { customerId: ["Elegí un cliente"] });
  if (!customer.active)
    throw new UserError("El cliente está inactivo.", { customerId: ["Cliente inactivo"] });
  if (input.promisedDate < today)
    throw new UserError("La fecha comprometida no puede ser anterior a hoy.", {
      promisedDate: ["Fecha anterior a hoy"],
    });

  const items = mergeItems(input.items);
  const priceListId = await resolvePriceList(db, customer);
  if (!priceListId)
    throw new UserError("El cliente no tiene lista de precios. Asignale una en su ficha.", {
      customerId: ["Sin lista de precios"],
    });
  const lines = await priceLines(db, items, priceListId, today);

  const total = orderTotal(lines);
  const [order] = await db
    .insert(schema.orders)
    .values({
      customerId: customer.id,
      priceListId,
      source: input.source,
      promisedDate: input.promisedDate,
      total,
      notes: input.notes,
      createdById: userId,
    })
    .returning();
  await db.insert(schema.orderItems).values(lines.map((l) => ({ orderId: order!.id, ...l })));
  await db.insert(schema.orderEvents).values({ orderId: order!.id, status: "received", byId: userId });
  return { id: order!.id, number: order!.number, total, kg: lines.reduce((a, l) => a + l.kg, 0) };
}

/** Valida productos y arma las líneas con el precio vigente de la lista. */
async function priceLines(db: Executor, items: Item[], priceListId: string, today: IsoDate) {
  const products = await db.query.products.findMany({
    where: inArray(
      schema.products.id,
      items.map((i) => i.productId),
    ),
  });
  const prices = (await currentPriceMap(db, today, priceListId))[priceListId] ?? {};
  return items.map((i) => {
    const p = products.find((x) => x.id === i.productId);
    if (!p || !p.active) throw new UserError("Hay un producto inexistente o inactivo en el pedido.");
    const unitPrice = prices[p.id];
    if (unitPrice == null)
      throw new UserError(`"${p.name}" no tiene precio vigente en la lista de precios del cliente.`, {
        items: [`Sin precio: ${p.name}`],
      });
    return { productId: p.id, qtyUnits: i.qtyUnits, unitPrice, kg: i.qtyUnits * p.netWeightKg };
  });
}

// ------------------------------------------------------------------------------------------------
// RF-03: consulta, listado, estados y edición
// ------------------------------------------------------------------------------------------------

export function getOrder(db: Executor, id: string) {
  return db.query.orders.findFirst({
    where: eq(schema.orders.id, id),
    with: {
      customer: { with: { zone: true } },
      priceList: true,
      createdBy: true,
      items: { with: { product: true }, orderBy: (t, { asc }) => asc(t.createdAt) },
      events: { with: { by: true }, orderBy: (t, { asc }) => asc(t.at) },
    },
  });
}
export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrder>>>;

/** Kg de un pedido a partir de sus ítems con producto. */
export function kgOf(items: { qtyUnits: number; product: { netWeightKg: number } }[]) {
  return orderKg(items.map((i) => ({ qtyUnits: i.qtyUnits, netWeightKg: i.product.netWeightKg })));
}

export async function listOrders(db: Executor, f: OrderFilters = {}, today: IsoDate = todayAR()) {
  const o = schema.orders;
  const where = and(
    f.status ? eq(o.status, f.status) : undefined,
    f.customerId ? eq(o.customerId, f.customerId) : undefined,
    f.from ? gte(o.promisedDate, f.from) : undefined,
    f.to ? lte(o.promisedDate, f.to) : undefined,
    f.overdue ? and(lt(o.promisedDate, today), notInArray(o.status, FINISHED_DELIVERY)) : undefined,
  );
  const rows = await db.query.orders.findMany({
    where,
    orderBy: [desc(o.promisedDate), desc(o.number)],
    limit: 300,
    with: { customer: true, items: { with: { product: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    customerId: r.customerId,
    customerName: r.customer.legalName,
    status: r.status,
    promisedDate: r.promisedDate,
    receivedAt: r.receivedAt,
    total: r.total,
    kg: kgOf(r.items),
    itemCount: r.items.length,
    overdue: isOrderOverdue({ promisedDate: r.promisedDate, status: r.status, today }),
  }));
}
export type OrderRow = Awaited<ReturnType<typeof listOrders>>[number];

/** Cantidad de pedidos atrasados (para badges y tableros). */
export async function countOverdueOrders(db: Executor, today: IsoDate = todayAR()) {
  const o = schema.orders;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(o)
    .where(and(lt(o.promisedDate, today), notInArray(o.status, FINISHED_DELIVERY)));
  return row?.n ?? 0;
}

async function lockOrder(db: Executor, id: string) {
  const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, id)).for("update");
  if (!row) throw new UserError("El pedido no existe.");
  return row;
}

/** RF-03: cambia el estado validando la transición con el dominio y registra el evento. */
export async function changeOrderStatus(
  db: Executor,
  userId: string | null,
  input: { id: string; to: OrderStatus; note?: string | null },
  now: Date = new Date(),
) {
  const order = await lockOrder(db, input.id);
  if (!canTransition(order.status, input.to))
    throw new UserError(
      `No se puede pasar el pedido de "${ORDER_STATUS[order.status]?.label}" a "${ORDER_STATUS[input.to]?.label}".`,
    );
  const reachesDelivery = input.to === "delivered" || input.to === "invoiced" || input.to === "paid";
  await db
    .update(schema.orders)
    .set({
      status: input.to,
      ...(reachesDelivery && !order.deliveredAt ? { deliveredAt: now } : {}),
    })
    .where(eq(schema.orders.id, order.id));
  await db
    .insert(schema.orderEvents)
    .values({ orderId: order.id, status: input.to, at: now, byId: userId, note: input.note ?? null });
  return { id: order.id, from: order.status, to: input.to };
}

/**
 * RF-03: edita ítems, fecha y notas. Solo en recibido/confirmado. Las líneas que ya existían
 * conservan su precio congelado; los productos agregados toman el precio vigente de la lista.
 */
export async function updateOrder(
  db: Executor,
  userId: string | null,
  input: UpdateOrderData,
  opts: { today?: IsoDate } = {},
) {
  const today = opts.today ?? todayAR();
  const order = await lockOrder(db, input.id);
  if (!isOrderEditable(order.status))
    throw new UserError(
      `El pedido está "${ORDER_STATUS[order.status]?.label}": solo se editan los pedidos recibidos o confirmados.`,
    );
  if (input.promisedDate !== order.promisedDate && input.promisedDate < today)
    throw new UserError("La fecha comprometida no puede ser anterior a hoy.", {
      promisedDate: ["Fecha anterior a hoy"],
    });

  const items = mergeItems(input.items);
  const existing = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
  const existingByProduct = new Map(existing.map((e) => [e.productId, e]));
  const newOnes = items.filter((i) => !existingByProduct.has(i.productId));
  let priced: Awaited<ReturnType<typeof priceLines>> = [];
  if (newOnes.length) {
    const customer = await db.query.customers.findFirst({ where: eq(schema.customers.id, order.customerId) });
    const listId = order.priceListId ?? (customer ? await resolvePriceList(db, customer) : null);
    if (!listId) throw new UserError("El cliente no tiene lista de precios.");
    priced = await priceLines(db, newOnes, listId, today);
  }

  const keep = new Set(items.map((i) => i.productId));
  const removed = existing.filter((e) => !keep.has(e.productId));
  if (removed.length)
    await db.delete(schema.orderItems).where(
      inArray(
        schema.orderItems.id,
        removed.map((r) => r.id),
      ),
    );
  for (const i of items) {
    const prev = existingByProduct.get(i.productId);
    if (prev) {
      if (prev.qtyUnits !== i.qtyUnits)
        await db
          .update(schema.orderItems)
          .set({ qtyUnits: i.qtyUnits })
          .where(eq(schema.orderItems.id, prev.id));
    }
  }
  if (priced.length)
    await db.insert(schema.orderItems).values(
      priced.map((l) => ({
        orderId: order.id,
        productId: l.productId,
        qtyUnits: l.qtyUnits,
        unitPrice: l.unitPrice,
      })),
    );

  const finalItems = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
  const total = orderTotal(finalItems);
  await db
    .update(schema.orders)
    .set({ total, promisedDate: input.promisedDate, notes: input.notes })
    .where(eq(schema.orders.id, order.id));
  await db.insert(schema.orderEvents).values({
    orderId: order.id,
    status: order.status,
    byId: userId,
    note: `Pedido modificado (total ${order.total} → ${total})`,
  });
  return { id: order.id, total };
}

// ------------------------------------------------------------------------------------------------
// RF-03: hoja de envasado del día
// ------------------------------------------------------------------------------------------------

/**
 * Hoja de envasado: pedidos con fecha comprometida `date` que todavía hay que preparar
 * (recibido, confirmado, en producción o listo), con totales por producto y por cliente.
 */
export async function packingSheet(db: Executor, date: IsoDate) {
  const o = schema.orders;
  const rows = await db
    .select({
      orderId: o.id,
      number: o.number,
      status: o.status,
      notes: o.notes,
      customerId: schema.customers.id,
      customerName: schema.customers.legalName,
      productId: schema.products.id,
      code: schema.products.code,
      productName: schema.products.name,
      boardCode: schema.products.boardCode,
      presentation: schema.products.presentation,
      netWeightKg: schema.products.netWeightKg,
      qtyUnits: schema.orderItems.qtyUnits,
    })
    .from(o)
    .innerJoin(schema.customers, eq(schema.customers.id, o.customerId))
    .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, o.id))
    .innerJoin(schema.products, eq(schema.products.id, schema.orderItems.productId))
    .where(and(eq(o.promisedDate, date), inArray(o.status, [...OPEN_ORDER_STATUSES])))
    .orderBy(asc(schema.customers.legalName), asc(o.number), asc(schema.products.code));

  const byProduct = new Map<
    string,
    { productId: string; code: string; name: string; boardCode: string | null; units: number; kg: number }
  >();
  interface SheetCustomer {
    customerId: string;
    name: string;
    orders: { id: string; number: number; status: OrderStatus; notes: string | null }[];
    lines: Map<string, { productId: string; name: string; units: number; kg: number }>;
    kg: number;
  }
  const byCustomer = new Map<string, SheetCustomer>();
  for (const r of rows) {
    const kg = roundQty(r.qtyUnits * r.netWeightKg);
    const p = byProduct.get(r.productId) ?? {
      productId: r.productId,
      code: r.code,
      name: r.productName,
      boardCode: r.boardCode,
      units: 0,
      kg: 0,
    };
    p.units += r.qtyUnits;
    p.kg = roundQty(p.kg + kg);
    byProduct.set(r.productId, p);

    const c: SheetCustomer = byCustomer.get(r.customerId) ?? {
      customerId: r.customerId,
      name: r.customerName,
      orders: [],
      lines: new Map(),
      kg: 0,
    };
    if (!c.orders.some((x) => x.id === r.orderId))
      c.orders.push({ id: r.orderId, number: r.number, status: r.status, notes: r.notes });
    const line = c.lines.get(r.productId) ?? { productId: r.productId, name: r.productName, units: 0, kg: 0 };
    line.units += r.qtyUnits;
    line.kg = roundQty(line.kg + kg);
    c.lines.set(r.productId, line);
    c.kg = roundQty(c.kg + kg);
    byCustomer.set(r.customerId, c);
  }
  const products = [...byProduct.values()].sort((a, b) => a.code.localeCompare(b.code));
  return {
    date,
    orderCount: new Set(rows.map((r) => r.orderId)).size,
    totalUnits: products.reduce((a, p) => a + p.units, 0),
    totalKg: roundQty(products.reduce((a, p) => a + p.kg, 0)),
    byProduct: products,
    byCustomer: [...byCustomer.values()].map((c) => ({ ...c, lines: [...c.lines.values()] })),
  };
}
export type PackingSheet = Awaited<ReturnType<typeof packingSheet>>;

// ------------------------------------------------------------------------------------------------
// RF-04: historial y frecuencia
// ------------------------------------------------------------------------------------------------

/** Fechas de pedido (día argentino de recepción, sin cancelados) por cliente. */
async function orderDatesByCustomer(db: Executor, customerId?: string) {
  const o = schema.orders;
  const rows = await db
    .select({ customerId: o.customerId, receivedAt: o.receivedAt })
    .from(o)
    .where(and(ne(o.status, "cancelled"), customerId ? eq(o.customerId, customerId) : undefined));
  const map = new Map<string, IsoDate[]>();
  for (const r of rows) {
    const list = map.get(r.customerId) ?? [];
    list.push(toIsoDateAR(r.receivedAt));
    map.set(r.customerId, list);
  }
  return map;
}

/** RF-04: estadísticas de compra de un cliente. */
export async function customerOrderStats(db: Executor, customerId: string, today: IsoDate = todayAR()) {
  const factor = await getSetting("orders.overdue_factor", 1.5);
  const dates = (await orderDatesByCustomer(db, customerId)).get(customerId) ?? [];
  const since90 = addDays(today, -90);
  const o = schema.orders;
  const all = await db.query.orders.findMany({
    where: and(eq(o.customerId, customerId), ne(o.status, "cancelled")),
    with: { items: { with: { product: true } } },
  });
  const recent = all.filter((r) => toIsoDateAR(r.receivedAt) >= since90);
  const average = averageOrderIntervalDays(dates);
  const lastOrderDate = dates.length ? [...dates].sort().at(-1)! : null;
  return {
    orderCount: dates.length,
    averageIntervalDays: average,
    daysSinceLastOrder: daysSinceLastOrder(dates, today),
    lastOrderDate,
    expectedNextDate: lastOrderDate && average != null ? addDays(lastOrderDate, Math.round(average)) : null,
    overdue: isCustomerOverdue({ orderDates: dates, today, toleranceFactor: factor }),
    overdueFactor: factor,
    last90Total: roundMoney(recent.reduce((a, r) => a + r.total, 0)),
    last90Kg: roundQty(recent.reduce((a, r) => a + kgOf(r.items), 0)),
    last90Orders: recent.length,
  };
}
export type CustomerOrderStats = Awaited<ReturnType<typeof customerOrderStats>>;

/** Historial de pedidos de un cliente (más recientes primero). */
export async function listCustomerOrders(db: Executor, customerId: string, limit = 25) {
  const today = todayAR();
  return (await listOrders(db, { customerId }, today)).slice(0, limit);
}

export interface OverdueCustomer {
  customerId: string;
  name: string;
  whatsapp: string | null;
  lastOrderDate: IsoDate;
  daysSinceLastOrder: number;
  averageIntervalDays: number;
  /** Cuándo les tocaba pedir según su frecuencia promedio. */
  expectedDate: IsoDate;
  /** Días de demora respecto del promedio. */
  daysLate: number;
}

/**
 * RF-04: "clientes para llamar" = clientes activos con frecuencia conocida (≥ 2 pedidos) cuyo último
 * pedido es más viejo que su intervalo promedio × `orders.overdue_factor` (1,5). Los más demorados primero.
 * Lo consume también el tablero (M8).
 */
export async function getOverdueCustomers(
  db: Executor,
  today: IsoDate = todayAR(),
): Promise<OverdueCustomer[]> {
  const factor = await getSetting("orders.overdue_factor", 1.5);
  const [customers, datesByCustomer] = await Promise.all([
    db.query.customers.findMany({
      where: and(eq(schema.customers.active, true), ne(schema.customers.channel, "store")),
    }),
    orderDatesByCustomer(db),
  ]);
  const out: { customer: OverdueCustomer; ratio: number }[] = [];
  for (const c of customers) {
    const dates = datesByCustomer.get(c.id) ?? [];
    if (!isCustomerOverdue({ orderDates: dates, today, toleranceFactor: factor })) continue;
    const average = averageOrderIntervalDays(dates)!;
    const since = daysSinceLastOrder(dates, today)!;
    const last = [...dates].sort().at(-1)!;
    out.push({
      customer: {
        customerId: c.id,
        name: c.legalName,
        whatsapp: c.whatsapp,
        lastOrderDate: last,
        daysSinceLastOrder: since,
        averageIntervalDays: average,
        expectedDate: addDays(last, Math.round(average)),
        daysLate: Math.round(since - average),
      },
      ratio: average > 0 ? since / average : Infinity,
    });
  }
  return out.sort((a, b) => b.ratio - a.ratio).map((o) => o.customer);
}

// ------------------------------------------------------------------------------------------------
// RF-05: fecha posible de un pedido grande
// ------------------------------------------------------------------------------------------------

export interface OrderDateEstimate {
  orderKg: number;
  /** Kg del pedido que ya están en stock terminado libre. */
  finishedStockKg: number;
  /** Kg que hay que producir. */
  shortfallKg: number;
  needsProduction: boolean;
  /** Primer día en que el pedido está completo (null si no entra en el horizonte). */
  date: IsoDate | null;
  /** Cronograma de producción sugerido. */
  schedule: { date: IsoDate; kg: number }[];
  capacityKg: number;
  workdays: number[];
  /** Kg ya planificados en planes de producción guardados (desde hoy). */
  plannedKg: number;
  /** Kg que otros pedidos abiertos todavía necesitan producir y se asumen antes que este. */
  backlogKg: number;
  today: IsoDate;
}

/**
 * RF-05 / Regla 10: fecha posible de entrega de un pedido (o de `kg` sueltos).
 *
 * - Stock terminado: unidades de `v_product_stock` × peso neto, de los productos del pedido, menos lo
 *   reservado por otros pedidos abiertos. Con `kg` sin ítems se usa el stock libre de todos los productos.
 * - Capacidad ocupada por día: planes de producción guardados (`production_plans.totalKg`, desde hoy) +
 *   el faltante de producción de los otros pedidos abiertos (se asume que se produce antes: primero llegado,
 *   primero servido).
 * - Capacidad y días hábiles: `production.daily_capacity_kg` y `production.workdays`.
 *
 * Exportado para otros módulos (despacho, tablero, producción).
 */
export async function estimateOrderDate(
  db: Executor,
  input: { items?: Item[]; kg?: number; today?: IsoDate; excludeOrderId?: string | null },
): Promise<OrderDateEstimate> {
  const today = input.today ?? todayAR();
  const [capacityKg, workdays] = await Promise.all([
    getSetting<number>("production.daily_capacity_kg", 150),
    getSetting<number[]>("production.workdays", [1, 2, 3, 4, 5]),
  ]);
  const [{ stock, reserved, free }, products, plans] = await Promise.all([
    availableFinishedUnits(db, input.excludeOrderId),
    db.select({ id: schema.products.id, netWeightKg: schema.products.netWeightKg }).from(schema.products),
    db
      .select({ date: schema.productionPlans.date, totalKg: schema.productionPlans.totalKg })
      .from(schema.productionPlans)
      .where(gte(schema.productionPlans.date, today)),
  ]);
  const weight = new Map(products.map((p) => [p.id, p.netWeightKg]));

  const items = mergeItems(input.items ?? []);
  let orderKgTotal: number;
  let coveredKg: number;
  if (items.length) {
    orderKgTotal = orderKg(
      items.map((i) => ({ qtyUnits: i.qtyUnits, netWeightKg: weight.get(i.productId) ?? 0 })),
    );
    coveredKg = roundQty(
      items.reduce(
        (acc, i) => acc + Math.min(i.qtyUnits, free[i.productId] ?? 0) * (weight.get(i.productId) ?? 0),
        0,
      ),
    );
  } else {
    orderKgTotal = roundQty(input.kg ?? 0);
    coveredKg = roundQty(Object.entries(free).reduce((acc, [id, u]) => acc + u * (weight.get(id) ?? 0), 0));
  }

  // Producción que otros pedidos abiertos ya necesitan (su demanda no cubierta por el stock).
  const othersShortfallKg = roundQty(
    Object.entries(reserved).reduce(
      (acc, [id, units]) => acc + Math.max(0, units - (stock[id] ?? 0)) * (weight.get(id) ?? 0),
      0,
    ),
  );
  const committedByPlan: Record<IsoDate, number> = {};
  let plannedKg = 0;
  for (const p of plans) {
    committedByPlan[p.date] = roundQty((committedByPlan[p.date] ?? 0) + p.totalKg);
    plannedKg = roundQty(plannedKg + p.totalKg);
  }
  const backlogKg = Math.max(0, roundQty(othersShortfallKg - plannedKg));
  const committedKgByDate = allocateBacklogKg({
    backlogKg,
    today,
    capacityKg,
    committedKgByDate: committedByPlan,
    workdays,
  });

  const est = estimateBigOrderDate({
    orderKg: orderKgTotal,
    finishedStockKg: coveredKg,
    today,
    capacityKg,
    committedKgByDate,
    workdays,
  });
  const shortfallKg = Math.max(0, roundQty(orderKgTotal - coveredKg));
  return {
    orderKg: orderKgTotal,
    finishedStockKg: Math.min(coveredKg, orderKgTotal),
    shortfallKg,
    needsProduction: shortfallKg > 0,
    date: est.date,
    schedule: est.schedule,
    capacityKg,
    workdays,
    plannedKg,
    backlogKg,
    today,
  };
}

/** RF-05: estimación para un pedido ya cargado (se excluye a sí mismo de la demanda). */
export async function estimateForOrder(db: Executor, orderId: string, today: IsoDate = todayAR()) {
  const order = await db.query.orders.findFirst({
    where: eq(schema.orders.id, orderId),
    with: { items: true },
  });
  if (!order) return null;
  return estimateOrderDate(db, {
    items: order.items.map((i) => ({ productId: i.productId, qtyUnits: i.qtyUnits })),
    excludeOrderId: order.id,
    today,
  });
}
