import { roundQty, type IsoDate } from "@chipa/domain";
import { asc, desc, eq, inArray, schema, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import { todayAR } from "@/lib/dates";
import { allocateProductFefo, finishedLotBalances, locationByCode } from "@/features/stock/ledger";
import { transferProduct } from "@/features/stock/service";
import type { ReplenishmentRequestData, ReplenishmentSendData } from "./schemas";
import { STORE_LOCATION } from "./service";

/**
 * Pedido de reposición del local a la planta.
 *   requested (el local pide) → sent (la planta transfirió F3/F4 → LOCAL por FEFO) → received (el local confirma).
 *   Un pedido sin enviar se puede cancelar.
 * El stock se mueve al ENVIAR (la planta saca del freezer y lo anota); "recibido" es la confirmación del local
 * para saber que llegó: si algo faltó o sobró, se corrige con un ajuste de inventario.
 */

const PLANT_LOCATIONS = ["F3", "F4"] as const;

export async function createReplenishment(
  db: Executor,
  userId: string | null,
  input: ReplenishmentRequestData,
  today: IsoDate = todayAR(),
) {
  if (input.neededBy && input.neededBy < today)
    throw new UserError("La fecha en que se necesita no puede ser anterior a hoy.", {
      neededBy: ["Elegí hoy o una fecha futura"],
    });
  const merged = new Map<string, number>();
  for (const i of input.items) merged.set(i.productId, (merged.get(i.productId) ?? 0) + i.qty);
  const products = await db.query.products.findMany({
    where: inArray(schema.products.id, [...merged.keys()]),
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const id of merged.keys()) {
    const p = byId.get(id);
    if (!p) throw new UserError("Uno de los productos no existe.");
    if (p.kind !== "manufactured")
      throw new UserError(`${p.name} no sale de la planta: la reventa se repone con el proveedor.`);
  }
  const [rep] = await db
    .insert(schema.storeReplenishments)
    .values({ requestedById: userId, neededBy: input.neededBy, notes: input.notes })
    .returning();
  await db
    .insert(schema.storeReplenishmentItems)
    .values(
      [...merged].map(([productId, qty]) => ({ replenishmentId: rep!.id, productId, qtyRequested: qty })),
    );
  return rep!;
}

async function load(db: Executor, id: string) {
  const rep = await db.query.storeReplenishments.findFirst({
    where: eq(schema.storeReplenishments.id, id),
    with: { items: { with: { product: true } } },
  });
  if (!rep) throw new UserError("El pedido de reposición no existe.");
  return rep;
}

/**
 * La planta envía el pedido: transfiere F3/F4 → LOCAL por FEFO la cantidad enviada de cada ítem (por defecto lo
 * pedido; se puede enviar menos). Si no alcanza el stock de planta, no se envía nada.
 */
export async function sendReplenishment(db: Executor, userId: string | null, input: ReplenishmentSendData) {
  const rep = await load(db, input.id);
  if (rep.status !== "requested")
    throw new UserError(rep.status === "cancelled" ? "El pedido está cancelado." : "Ese pedido ya se envió.");
  const override = new Map((input.items ?? []).map((i) => [i.itemId, i.qty]));
  for (const id of override.keys())
    if (!rep.items.some((i) => i.id === id)) throw new UserError("Uno de los ítems no es de este pedido.");
  const [local, plant] = await Promise.all([
    locationByCode(db, STORE_LOCATION),
    Promise.all(PLANT_LOCATIONS.map((c) => locationByCode(db, c))),
  ]);
  const plantIds = plant.map((l) => l.id);
  const toSend = rep.items.map((i) => ({ item: i, qty: override.get(i.id) ?? i.qtyRequested }));
  if (!toSend.some((x) => x.qty > 0)) throw new UserError("Enviá al menos un producto o cancelá el pedido.");

  for (const { item, qty } of toSend) {
    if (qty > 0) {
      const { allocations, shortfall } = await allocateProductFefo(db, item.productId, qty, {
        locationIds: plantIds,
        allowShortfall: true,
      });
      if (shortfall > 0)
        throw new UserError(
          `No hay stock suficiente de ${item.product.name} en F3 y F4: hay ${roundQty(qty - shortfall)} y se envían ${qty}.`,
        );
      for (const a of allocations)
        await transferProduct(db, userId, {
          productId: item.productId,
          fromLocationId: a.locationId,
          toLocationId: local.id,
          finishedLotId: a.finishedLotId,
          units: a.qty,
          note: `Reposición del local #${rep.number}`,
        });
    }
    await db
      .update(schema.storeReplenishmentItems)
      .set({ qtySent: qty })
      .where(eq(schema.storeReplenishmentItems.id, item.id));
  }
  const [updated] = await db
    .update(schema.storeReplenishments)
    .set({ status: "sent", sentById: userId, sentAt: new Date() })
    .where(eq(schema.storeReplenishments.id, rep.id))
    .returning();
  return { replenishment: updated!, sentUnits: toSend.reduce((a, x) => a + x.qty, 0) };
}

/** El local confirma que llegó la mercadería enviada. */
export async function receiveReplenishment(db: Executor, userId: string | null, id: string) {
  const rep = await load(db, id);
  if (rep.status !== "sent")
    throw new UserError(
      rep.status === "received"
        ? "Ese pedido ya está recibido."
        : "Solo se puede recibir un pedido que la planta ya envió.",
    );
  const [updated] = await db
    .update(schema.storeReplenishments)
    .set({ status: "received", receivedById: userId, receivedAt: new Date() })
    .where(eq(schema.storeReplenishments.id, id))
    .returning();
  return updated!;
}

/** Cancela un pedido que todavía no se envió. */
export async function cancelReplenishment(db: Executor, id: string) {
  const rep = await load(db, id);
  if (rep.status !== "requested")
    throw new UserError(
      rep.status === "cancelled"
        ? "Ese pedido ya está cancelado."
        : "Un pedido enviado no se puede cancelar.",
    );
  const [updated] = await db
    .update(schema.storeReplenishments)
    .set({ status: "cancelled" })
    .where(eq(schema.storeReplenishments.id, id))
    .returning();
  return updated!;
}

/** Pedidos de reposición con sus ítems (más recientes primero). */
export async function listReplenishments(
  db: Executor,
  opts: { statuses?: ("requested" | "sent" | "received" | "cancelled")[]; limit?: number } = {},
) {
  return db.query.storeReplenishments.findMany({
    where: opts.statuses?.length ? inArray(schema.storeReplenishments.status, opts.statuses) : undefined,
    with: { items: { with: { product: true } }, requestedBy: true, sentBy: true, receivedBy: true },
    orderBy: [desc(schema.storeReplenishments.requestedAt)],
    limit: opts.limit ?? 30,
  });
}
export type ReplenishmentRow = Awaited<ReturnType<typeof listReplenishments>>[number];

export interface PendingReplenishment {
  id: string;
  number: number;
  requestedAt: Date;
  requestedBy: string | null;
  /** Fecha en que el local necesita la mercadería. */
  neededBy: IsoDate | null;
  /** Ya pasó la fecha en que se necesitaba. */
  overdue: boolean;
  notes: string | null;
  totalUnits: number;
  items: { productId: string; code: string; name: string; qtyRequested: number }[];
}

/**
 * Pedidos del local que la planta todavía tiene que enviar (estado `requested`), el más urgente primero
 * (por fecha de necesidad y luego por antigüedad). Lo usa el tablero.
 */
export async function getPendingReplenishments(
  db: Executor,
  today: IsoDate = todayAR(),
): Promise<PendingReplenishment[]> {
  const rows = await db.query.storeReplenishments.findMany({
    where: eq(schema.storeReplenishments.status, "requested"),
    with: { items: { with: { product: true } }, requestedBy: true },
    orderBy: [asc(schema.storeReplenishments.requestedAt)],
  });
  return rows
    .map((r) => ({
      id: r.id,
      number: r.number,
      requestedAt: r.requestedAt,
      requestedBy: r.requestedBy?.name ?? null,
      neededBy: r.neededBy,
      overdue: r.neededBy != null && r.neededBy < today,
      notes: r.notes,
      totalUnits: r.items.reduce((a, i) => a + i.qtyRequested, 0),
      items: r.items
        .map((i) => ({
          productId: i.productId,
          code: i.product.code,
          name: i.product.name,
          qtyRequested: i.qtyRequested,
        }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    }))
    .sort((a, b) => (a.neededBy ?? "9999-12-31").localeCompare(b.neededBy ?? "9999-12-31"));
}

/** Stock disponible (sin lotes retenidos) en F3 + F4 por producto: lo que la planta puede enviar. */
export async function plantStockByProduct(db: Executor, productIds: string[]) {
  const out = new Map<string, number>();
  if (!productIds.length) return out;
  const plant = await Promise.all(PLANT_LOCATIONS.map((c) => locationByCode(db, c)));
  for (const id of productIds) {
    const balances = await finishedLotBalances(db, id, { locationIds: plant.map((l) => l.id) });
    out.set(id, roundQty(balances.reduce((a, b) => a + b.qty, 0)));
  }
  return out;
}
