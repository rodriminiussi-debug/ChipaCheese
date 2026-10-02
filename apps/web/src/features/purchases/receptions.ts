import { asc, desc, eq, inArray, schema, type Executor } from "@chipa/db";
import { isTemperatureAlert, poStatusAfterReception, roundQty } from "@chipa/domain";
import { UserError } from "@/server/errors";
import { recordIngredientMovements } from "@/features/stock/ledger";
import { getOrder, receivedByIngredient } from "./orders";
import type { ReceptionData } from "./schemas";

/**
 * Recepción de mercadería (RF-11): cantidad real, lote del proveedor, vencimiento y temperatura de
 * los refrigerados. Crea `receptions`, un `raw_lots` por línea y el movimiento `receipt` en el libro
 * mayor; si viene de una OC, actualiza su estado.
 */

/** Ubicaciones de materia prima y los códigos por defecto (HELADERA refrigerados, DEP-SECO el resto). */
export async function receptionLocations(db: Executor) {
  const locations = await db.query.locations.findMany({
    where: eq(schema.locations.kind, "raw"),
    orderBy: asc(schema.locations.name),
  });
  const byCode = (code: string) => locations.find((l) => l.code === code)?.id ?? locations[0]?.id ?? "";
  return {
    locations: locations.map((l) => ({ id: l.id, code: l.code, name: l.name })),
    fridgeId: byCode("HELADERA"),
    dryId: byCode("DEP-SECO"),
  };
}

/** Datos para el formulario de recepción: insumos con sus flags y, si hay OC, lo pendiente de cada línea. */
export async function receptionFormData(db: Executor, orderId?: string | null) {
  const [places, ingredients, suppliers, sold] = await Promise.all([
    receptionLocations(db),
    db.query.ingredients.findMany({ where: eq(schema.ingredients.active, true), orderBy: asc(schema.ingredients.name) }),
    db.query.suppliers.findMany({ where: eq(schema.suppliers.active, true), orderBy: asc(schema.suppliers.legalName) }),
    db.query.supplierIngredients.findMany(),
  ]);
  const order = orderId ? await getOrder(db, orderId) : null;
  return {
    ...places,
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.legalName })),
    ingredients: ingredients.map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      refrigerated: i.refrigerated,
      category: i.category,
      supplierIds: sold.filter((x) => x.ingredientId === i.id).map((x) => x.supplierId),
    })),
    order: order
      ? {
          id: order.id,
          number: order.number,
          supplierId: order.supplierId,
          status: order.status,
          lines: order.items
            .map((i) => ({ ingredientId: i.ingredientId, ordered: i.qty, received: i.received, pending: roundQty(Math.max(0, i.qty - i.received)) }))
            .filter((l) => l.pending > 0),
        }
      : null,
  };
}
export type ReceptionFormData = Awaited<ReturnType<typeof receptionFormData>>;

export async function createReception(db: Executor, userId: string | null, input: ReceptionData) {
  const supplier = await db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, input.supplierId) });
  if (!supplier) throw new UserError("El proveedor no existe.");

  const order = input.purchaseOrderId
    ? await db.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, input.purchaseOrderId) })
    : null;
  if (input.purchaseOrderId) {
    if (!order) throw new UserError("La orden de compra no existe.");
    if (order.supplierId !== input.supplierId) throw new UserError("La orden es de otro proveedor.");
    if (order.status === "cancelled") throw new UserError("La orden está cancelada.");
    if (order.status === "received") throw new UserError("La orden ya fue recibida completa.");
  }

  const lines = input.lines.map((l, index) => ({ ...l, index })).filter((l) => l.qty > 0);
  if (!lines.length) throw new UserError("Cargá la cantidad recibida de al menos un insumo.");

  const ingredients = await db.query.ingredients.findMany({
    where: inArray(schema.ingredients.id, [...new Set(lines.map((l) => l.ingredientId))]),
  });
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const locationIds = [...new Set(lines.map((l) => l.locationId))];
  const locations = await db.query.locations.findMany({ where: inArray(schema.locations.id, locationIds) });
  if (locations.length !== locationIds.length) throw new UserError("Alguna ubicación no existe.");

  // Reglas BPM por línea.
  for (const l of lines) {
    const ing = byId.get(l.ingredientId);
    if (!ing) throw new UserError("Algún insumo no existe.");
    const f = (field: string, msg: string) => new UserError(`${ing.name}: ${msg}`, { [`lines.${l.index}.${field}`]: [msg] });
    if (ing.refrigerated && l.temperatureC == null) throw f("temperatureC", "la temperatura es obligatoria para refrigerados");
    if (ing.refrigerated && !l.expiryDate) throw f("expiryDate", "el vencimiento es obligatorio para refrigerados");
    if (ing.category !== "packaging" && !l.supplierLotCode) throw f("supplierLotCode", "falta el lote del proveedor");
  }

  const [reception] = await db
    .insert(schema.receptions)
    .values({
      supplierId: input.supplierId,
      purchaseOrderId: input.purchaseOrderId,
      receivedById: userId,
      deliveryNote: input.deliveryNote,
      notes: input.notes,
    })
    .returning();

  const lots = await db
    .insert(schema.rawLots)
    .values(
      lines.map((l) => ({
        ingredientId: l.ingredientId,
        supplierId: input.supplierId,
        receptionId: reception!.id,
        supplierLotCode: l.supplierLotCode,
        expiryDate: l.expiryDate,
        receivedQty: l.qty,
        temperatureC: l.temperatureC,
        locationId: l.locationId,
      })),
    )
    .returning();

  await recordIngredientMovements(
    db,
    userId,
    lots.map((lot) => ({
      type: "receipt" as const,
      ingredientId: lot.ingredientId,
      rawLotId: lot.id,
      locationId: lot.locationId!,
      qty: lot.receivedQty,
      refTable: "receptions",
      refId: reception!.id,
    })),
  );

  let orderStatus = order?.status ?? null;
  if (order) {
    const orderItems = await db.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, order.id),
    });
    orderStatus = poStatusAfterReception(
      orderItems.map((i) => ({ ingredientId: i.ingredientId, qty: i.qty })),
      await receivedByIngredient(db, order.id),
      order.status,
    );
    if (orderStatus !== order.status)
      await db.update(schema.purchaseOrders).set({ status: orderStatus }).where(eq(schema.purchaseOrders.id, order.id));
  }

  const alerts = lines
    .filter((l) => l.temperatureC != null && isTemperatureAlert(l.temperatureC))
    .map((l) => ({ ingredient: byId.get(l.ingredientId)!.name, temperatureC: l.temperatureC! }));
  return { id: reception!.id, lots: lots.length, alerts, orderStatus };
}

export async function listReceptions(db: Executor, limit = 50) {
  const receptions = await db.query.receptions.findMany({
    orderBy: desc(schema.receptions.receivedAt),
    limit,
    with: { supplier: true, purchaseOrder: true, receivedBy: true },
  });
  if (!receptions.length) return [];
  const lots = await db.query.rawLots.findMany({
    where: inArray(
      schema.rawLots.receptionId,
      receptions.map((r) => r.id),
    ),
    with: { ingredient: true, location: true },
    orderBy: asc(schema.rawLots.createdAt),
  });
  return receptions.map((r) => ({ ...r, lots: lots.filter((l) => l.receptionId === r.id) }));
}
export type ReceptionRow = Awaited<ReturnType<typeof listReceptions>>[number];
