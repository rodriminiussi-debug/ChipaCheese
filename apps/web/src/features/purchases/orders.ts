import { and, asc, desc, eq, inArray, schema, sql, type Executor } from "@chipa/db";
import { addDays, deliveryTiming, nextPoNumber, type IsoDate } from "@chipa/domain";
import { UserError } from "@/server/errors";
import { getLatestPrices } from "./prices";
import type { PurchaseOrderData } from "./schemas";

/** Órdenes de compra (RF-10): draft → sent → partially_received / received / cancelled. */

export async function listOrders(
  db: Executor,
  f: { status?: (typeof schema.purchaseOrderStatusEnum.enumValues)[number]; supplierId?: string } = {},
) {
  const o = schema.purchaseOrders;
  return db.query.purchaseOrders.findMany({
    where: and(
      f.status ? eq(o.status, f.status) : undefined,
      f.supplierId ? eq(o.supplierId, f.supplierId) : undefined,
    ),
    orderBy: [desc(o.orderedAt), desc(o.number)],
    with: { supplier: true },
    limit: 200,
  });
}

export async function getOrder(db: Executor, id: string) {
  const order = await db.query.purchaseOrders.findFirst({
    where: eq(schema.purchaseOrders.id, id),
    with: { supplier: true, responsible: true },
  });
  if (!order) return null;
  const items = await db.query.purchaseOrderItems.findMany({
    where: eq(schema.purchaseOrderItems.purchaseOrderId, id),
    orderBy: asc(schema.purchaseOrderItems.createdAt),
    with: { ingredient: true },
  });
  const received = await receivedByIngredient(db, id);
  return {
    ...order,
    items: items.map((i) => ({ ...i, received: received[i.ingredientId] ?? 0 })),
  };
}
export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrder>>>;

/** Cantidad recibida de cada insumo contra una OC (suma de lotes de sus recepciones). */
export async function receivedByIngredient(db: Executor, orderId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({
      ingredientId: schema.rawLots.ingredientId,
      qty: sql<number>`sum(${schema.rawLots.receivedQty})`.mapWith(Number),
    })
    .from(schema.rawLots)
    .innerJoin(schema.receptions, eq(schema.receptions.id, schema.rawLots.receptionId))
    .where(eq(schema.receptions.purchaseOrderId, orderId))
    .groupBy(schema.rawLots.ingredientId);
  return Object.fromEntries(rows.map((r) => [r.ingredientId, r.qty]));
}

/** Entregas esperadas: OC enviadas o parcialmente recibidas, con su atraso respecto de hoy. */
export async function expectedDeliveries(db: Executor, today: IsoDate) {
  const o = schema.purchaseOrders;
  const orders = await db.query.purchaseOrders.findMany({
    where: inArray(o.status, ["sent", "partially_received"]),
    orderBy: [asc(sql`coalesce(${o.expectedAt}, '9999-12-31')`), asc(o.number)],
    with: { supplier: true },
  });
  return orders.map((order) => ({ order, timing: deliveryTiming(order.expectedAt, today) }));
}

async function normalizeItems(db: Executor, items: PurchaseOrderData["items"]) {
  const ids = [...new Set(items.map((i) => i.ingredientId))];
  const ingredients = await db.query.ingredients.findMany({ where: inArray(schema.ingredients.id, ids) });
  if (ingredients.length !== ids.length) throw new UserError("Algún insumo de la orden no existe.");
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const latest = await getLatestPrices(db);
  return items.map((i) => ({
    ingredientId: i.ingredientId,
    qty: i.qty,
    unit: byId.get(i.ingredientId)!.unit,
    // Precio estimado = último precio de compra, si no lo cargaron.
    estimatedUnitPrice: i.estimatedUnitPrice ?? latest[i.ingredientId]?.unitPriceNet ?? null,
  }));
}

async function insertOrderItems(
  db: Executor,
  orderId: string,
  items: Awaited<ReturnType<typeof normalizeItems>>,
) {
  const base = Date.now();
  await db
    .insert(schema.purchaseOrderItems)
    .values(items.map((it, idx) => ({ purchaseOrderId: orderId, ...it, createdAt: new Date(base + idx) })));
}

export async function createOrder(db: Executor, userId: string | null, input: PurchaseOrderData) {
  const supplier = await db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, input.supplierId) });
  if (!supplier) throw new UserError("El proveedor no existe.");
  const items = await normalizeItems(db, input.items);
  const numbers = await db.select({ number: schema.purchaseOrders.number }).from(schema.purchaseOrders);
  const [order] = await db
    .insert(schema.purchaseOrders)
    .values({
      number: nextPoNumber(numbers.map((n) => n.number)),
      supplierId: input.supplierId,
      orderedAt: input.orderedAt,
      // Fecha esperada por defecto: pedido + plazo de entrega del proveedor.
      expectedAt: input.expectedAt ?? addDays(input.orderedAt, supplier.leadTimeDays),
      responsibleId: input.responsibleId ?? userId,
      notes: input.notes,
      status: "draft",
    })
    .returning();
  await insertOrderItems(db, order!.id, items);
  return order!;
}

export async function updateOrder(db: Executor, id: string, input: PurchaseOrderData) {
  const order = await db.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, id) });
  if (!order) throw new UserError("La orden no existe.");
  if (order.status !== "draft") throw new UserError("Solo se pueden editar órdenes en borrador.");
  const items = await normalizeItems(db, input.items);
  const [row] = await db
    .update(schema.purchaseOrders)
    .set({
      supplierId: input.supplierId,
      orderedAt: input.orderedAt,
      expectedAt: input.expectedAt,
      responsibleId: input.responsibleId,
      notes: input.notes,
    })
    .where(eq(schema.purchaseOrders.id, id))
    .returning();
  await db.delete(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.purchaseOrderId, id));
  await insertOrderItems(db, id, items);
  return row!;
}

/** draft → sent | cancelled; sent → cancelled (si todavía no llegó nada). */
export async function changeOrderStatus(db: Executor, id: string, status: "sent" | "cancelled") {
  const order = await db.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, id) });
  if (!order) throw new UserError("La orden no existe.");
  if (order.status === status) return order;
  const allowed =
    (order.status === "draft" && (status === "sent" || status === "cancelled")) ||
    (order.status === "sent" && status === "cancelled");
  if (!allowed) {
    throw new UserError(
      order.status === "partially_received" || order.status === "received"
        ? "La orden ya tiene mercadería recibida: no se puede cambiar su estado."
        : `No se puede pasar una orden ${order.status === "cancelled" ? "cancelada" : "enviada"} a ese estado.`,
    );
  }
  const [row] = await db
    .update(schema.purchaseOrders)
    .set({ status })
    .where(eq(schema.purchaseOrders.id, id))
    .returning();
  return row!;
}

/** Opciones del formulario de OC: proveedores (con sus insumos), insumos con último precio y usuarios. */
export async function orderFormOptions(db: Executor) {
  const [suppliers, sold, ingredients, users, latest] = await Promise.all([
    db.query.suppliers.findMany({
      where: eq(schema.suppliers.active, true),
      orderBy: asc(schema.suppliers.legalName),
    }),
    db.query.supplierIngredients.findMany(),
    db.query.ingredients.findMany({
      where: eq(schema.ingredients.active, true),
      orderBy: asc(schema.ingredients.name),
    }),
    db.query.users.findMany({ where: eq(schema.users.active, true), orderBy: asc(schema.users.name) }),
    getLatestPrices(db),
  ]);
  return {
    suppliers: suppliers.map((s) => ({
      id: s.id,
      name: s.legalName,
      leadTimeDays: s.leadTimeDays,
      ingredientIds: sold.filter((x) => x.supplierId === s.id).map((x) => x.ingredientId),
    })),
    ingredients: ingredients.map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      lastPrice: latest[i.id]?.unitPriceNet ?? null,
    })),
    users: users.filter((u) => u.role !== "operator").map((u) => ({ id: u.id, name: u.name })),
  };
}
