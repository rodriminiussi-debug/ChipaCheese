import { countDifference, formatDateAR, roundQty, valueDifference, type IsoDate } from "@chipa/domain";
import { and, asc, desc, eq, schema, sql, type Executor } from "@chipa/db";
import { todayAR } from "@/lib/dates";
import { UserError } from "@/server/errors";
import { recordIngredientMovements, recordProductMovements } from "./ledger";
import type { CreateCountInput } from "./schemas";

/**
 * Inventario físico guiado (RF-15). Flujo: draft (se precarga con el saldo del sistema por
 * ítem × lote × ubicación) → se carga lo contado (se puede guardar parcial) → confirmed:
 * por cada diferencia se registra un movimiento `adjustment` con el lote, referenciado al conteo.
 */

export async function listInventoryCounts(db: Executor) {
  const counts = await db.query.inventoryCounts.findMany({
    orderBy: [desc(schema.inventoryCounts.date), desc(schema.inventoryCounts.createdAt)],
    with: { countedBy: true },
  });
  const stats = await db
    .select({
      countId: schema.inventoryCountItems.countId,
      items: sql<number>`count(*)`.mapWith(Number),
      counted: sql<number>`count(${schema.inventoryCountItems.countedQty})`.mapWith(Number),
      withDiff:
        sql<number>`count(*) filter (where ${schema.inventoryCountItems.countedQty} is not null and ${schema.inventoryCountItems.countedQty} <> ${schema.inventoryCountItems.systemQty})`.mapWith(
          Number,
        ),
    })
    .from(schema.inventoryCountItems)
    .groupBy(schema.inventoryCountItems.countId);
  const byCount = new Map(stats.map((s) => [s.countId, s]));
  return counts.map((c) => ({
    ...c,
    items: byCount.get(c.id)?.items ?? 0,
    counted: byCount.get(c.id)?.counted ?? 0,
    withDiff: byCount.get(c.id)?.withDiff ?? 0,
  }));
}

/** Saldo actual por posición (ítem × lote × ubicación) para precargar o refrescar un conteo. */
async function currentPositions(db: Executor, kind: "ingredient" | "product") {
  if (kind === "ingredient") {
    const rows = await db
      .select({
        ingredientId: schema.ingredientStock.ingredientId,
        rawLotId: schema.ingredientStock.rawLotId,
        locationId: schema.ingredientStock.locationId,
        qty: schema.ingredientStock.qty,
      })
      .from(schema.ingredientStock);
    return rows.map((r) => ({
      ingredientId: r.ingredientId as string | null,
      productId: null as string | null,
      rawLotId: r.rawLotId,
      finishedLotId: null as string | null,
      locationId: r.locationId,
      qty: roundQty(r.qty),
    }));
  }
  const rows = await db
    .select({
      productId: schema.productStock.productId,
      finishedLotId: schema.productStock.finishedLotId,
      locationId: schema.productStock.locationId,
      qty: schema.productStock.qty,
    })
    .from(schema.productStock);
  return rows.map((r) => ({
    ingredientId: null as string | null,
    productId: r.productId as string | null,
    rawLotId: null as string | null,
    finishedLotId: r.finishedLotId,
    locationId: r.locationId,
    qty: roundQty(r.qty),
  }));
}

export async function createInventoryCount(db: Executor, userId: string | null, input: CreateCountInput) {
  const [count] = await db
    .insert(schema.inventoryCounts)
    .values({
      date: todayAR(),
      itemKind: input.itemKind,
      status: "draft",
      countedById: userId,
      notes: input.notes ?? null,
    })
    .returning();
  const positions = await currentPositions(db, input.itemKind);
  if (positions.length) {
    await db.insert(schema.inventoryCountItems).values(
      positions.map((p) => ({
        countId: count!.id,
        ingredientId: p.ingredientId,
        productId: p.productId,
        rawLotId: p.rawLotId,
        finishedLotId: p.finishedLotId,
        locationId: p.locationId,
        systemQty: p.qty,
      })),
    );
  }
  return { id: count!.id, items: positions.length };
}

export interface CountItemRow {
  id: string;
  itemName: string;
  unit: "kg" | "l" | "unit";
  itemId: string;
  lotCode: string | null;
  expiryDate: IsoDate | null;
  locationId: string;
  locationCode: string;
  locationName: string;
  systemQty: number;
  countedQty: number | null;
  /** contado − sistema; null si todavía no se contó. */
  diff: number | null;
  unitPriceNet: number | null;
  /** Diferencia valorizada (solo insumos con precio). */
  diffValue: number | null;
}

export async function getInventoryCount(db: Executor, countId: string) {
  const count = await db.query.inventoryCounts.findFirst({
    where: eq(schema.inventoryCounts.id, countId),
    with: { countedBy: true },
  });
  if (!count) return null;
  const i = schema.inventoryCountItems;
  const rows = await db
    .select({
      id: i.id,
      ingredientId: i.ingredientId,
      productId: i.productId,
      ingredientName: schema.ingredients.name,
      ingredientUnit: schema.ingredients.unit,
      productName: schema.products.name,
      rawLotCode: schema.rawLots.supplierLotCode,
      rawExpiry: schema.rawLots.expiryDate,
      finishedLotCode: schema.finishedLots.code,
      finishedExpiry: schema.finishedLots.expiryDate,
      locationId: i.locationId,
      locationCode: schema.locations.code,
      locationName: schema.locations.name,
      systemQty: i.systemQty,
      countedQty: i.countedQty,
      unitPriceNet: schema.ingredientLastPrice.unitPriceNet,
    })
    .from(i)
    .innerJoin(schema.locations, eq(schema.locations.id, i.locationId))
    .leftJoin(schema.ingredients, eq(schema.ingredients.id, i.ingredientId))
    .leftJoin(schema.products, eq(schema.products.id, i.productId))
    .leftJoin(schema.rawLots, eq(schema.rawLots.id, i.rawLotId))
    .leftJoin(schema.finishedLots, eq(schema.finishedLots.id, i.finishedLotId))
    .leftJoin(schema.ingredientLastPrice, eq(schema.ingredientLastPrice.ingredientId, i.ingredientId))
    .where(eq(i.countId, countId))
    .orderBy(
      asc(schema.locations.code),
      asc(schema.ingredients.name),
      asc(schema.products.code),
      asc(schema.rawLots.expiryDate),
    );

  const items: CountItemRow[] = rows.map((r) => {
    const diff = r.countedQty == null ? null : countDifference(r.systemQty, r.countedQty);
    const price = r.ingredientId ? (r.unitPriceNet ?? null) : null;
    return {
      id: r.id,
      itemName: (r.ingredientId ? r.ingredientName : r.productName) ?? "—",
      unit: r.ingredientId ? (r.ingredientUnit ?? "kg") : "unit",
      itemId: (r.ingredientId ?? r.productId)!,
      lotCode: r.ingredientId ? r.rawLotCode : r.finishedLotCode,
      expiryDate: r.ingredientId ? r.rawExpiry : r.finishedExpiry,
      locationId: r.locationId,
      locationCode: r.locationCode,
      locationName: r.locationName,
      systemQty: r.systemQty,
      countedQty: r.countedQty,
      diff,
      unitPriceNet: price,
      diffValue: diff == null ? null : valueDifference(diff, price),
    };
  });
  const counted = items.filter((x) => x.countedQty != null);
  const withDiff = counted.filter((x) => x.diff !== 0);
  return {
    count,
    items,
    summary: {
      total: items.length,
      counted: counted.length,
      pending: items.length - counted.length,
      withDiff: withDiff.length,
      totalDiffValue: roundQty(withDiff.reduce((a, x) => a + (x.diffValue ?? 0), 0)),
    },
  };
}
export type InventoryCountDetail = NonNullable<Awaited<ReturnType<typeof getInventoryCount>>>;

async function assertDraft(db: Executor, countId: string) {
  const count = await db.query.inventoryCounts.findFirst({ where: eq(schema.inventoryCounts.id, countId) });
  if (!count) throw new UserError("El inventario no existe.");
  if (count.status !== "draft") throw new UserError("El inventario ya está cerrado.");
  return count;
}

/**
 * Guarda lo contado hasta ahora (avance parcial). `null` = todavía sin contar.
 *
 * Con `opts` (envío desde la cola offline) es idempotente: el avance es el estado ABSOLUTO de lo contado, así
 * que un reenvío (mismo `clientId`) o un envío más viejo que el último aplicado (`recordedAt` anterior, p. ej.
 * una cola que se vacía después de haber guardado en línea) se descarta en vez de pisar lo más nuevo.
 */
export async function saveCountItems(
  db: Executor,
  userId: string | null,
  countId: string,
  items: { id: string; countedQty: number | null }[],
  opts: { clientId?: string | null; recordedAt?: Date } = {},
) {
  const count = await assertDraft(db, countId);
  if (opts.clientId && count.lastSaveClientId === opts.clientId)
    return { saved: 0, duplicate: true as const, stale: false as const };
  if (opts.recordedAt && count.lastSavedAt && opts.recordedAt.getTime() < count.lastSavedAt.getTime())
    return { saved: 0, duplicate: false as const, stale: true as const };
  for (const it of items) {
    const res = await db
      .update(schema.inventoryCountItems)
      .set({ countedQty: it.countedQty })
      .where(and(eq(schema.inventoryCountItems.id, it.id), eq(schema.inventoryCountItems.countId, countId)))
      .returning({ id: schema.inventoryCountItems.id });
    if (!res.length) throw new UserError("Una de las posiciones no pertenece a este inventario.");
  }
  await db
    .update(schema.inventoryCounts)
    .set({
      countedById: userId,
      ...(opts.clientId || opts.recordedAt
        ? { lastSaveClientId: opts.clientId ?? null, lastSavedAt: opts.recordedAt ?? new Date() }
        : {}),
    })
    .where(eq(schema.inventoryCounts.id, countId));
  return { saved: items.length, duplicate: false as const, stale: false as const };
}

/**
 * Confirma el inventario. Para cada posición contada se toma el saldo ACTUAL del sistema
 * (pudo moverse desde que se creó el conteo), se actualiza `systemQty` y, si hay diferencia,
 * se registra un movimiento `adjustment` (con lote) referenciado al conteo.
 * Las posiciones sin contar no se tocan.
 */
export async function confirmInventoryCount(
  db: Executor,
  userId: string | null,
  countId: string,
  items: { id: string; countedQty: number | null }[] = [],
) {
  const count = await assertDraft(db, countId);
  if (items.length) await saveCountItems(db, userId, countId, items);

  const rows = await db.query.inventoryCountItems.findMany({
    where: eq(schema.inventoryCountItems.countId, countId),
  });
  const counted = rows.filter((r) => r.countedQty != null);
  if (!counted.length) throw new UserError("Cargá al menos una cantidad contada antes de confirmar.");

  // Tomar el conteo (draft → confirmed) de forma atómica para evitar doble confirmación.
  const claimed = await db
    .update(schema.inventoryCounts)
    .set({ status: "confirmed", countedById: userId })
    .where(and(eq(schema.inventoryCounts.id, countId), eq(schema.inventoryCounts.status, "draft")))
    .returning({ id: schema.inventoryCounts.id });
  if (!claimed.length) throw new UserError("El inventario ya fue confirmado.");

  const current = await currentPositions(db, count.itemKind);
  const key = (p: {
    ingredientId: string | null;
    productId: string | null;
    rawLotId: string | null;
    finishedLotId: string | null;
    locationId: string;
  }) => [p.ingredientId ?? p.productId, p.rawLotId ?? p.finishedLotId ?? "-", p.locationId].join("|");
  const balance = new Map(current.map((p) => [key(p), p.qty]));

  const ingredientMoves = [];
  const productMoves = [];
  let adjusted = 0;
  for (const r of counted) {
    const system = balance.get(key(r)) ?? 0;
    const diff = countDifference(system, r.countedQty!);
    await db
      .update(schema.inventoryCountItems)
      .set({ systemQty: system })
      .where(eq(schema.inventoryCountItems.id, r.id));
    if (diff === 0) continue;
    adjusted++;
    const base = {
      type: "adjustment" as const,
      locationId: r.locationId,
      qty: diff,
      refTable: "inventory_counts",
      refId: countId,
      note: `Inventario físico ${formatDateAR(count.date)}`,
    };
    if (r.ingredientId) ingredientMoves.push({ ...base, ingredientId: r.ingredientId, rawLotId: r.rawLotId });
    else productMoves.push({ ...base, productId: r.productId!, finishedLotId: r.finishedLotId });
  }
  await recordIngredientMovements(db, userId, ingredientMoves);
  await recordProductMovements(db, userId, productMoves);
  return { adjusted, counted: counted.length, pending: rows.length - counted.length };
}

/** Anula un inventario en curso (no genera movimientos). */
export async function voidInventoryCount(db: Executor, countId: string) {
  await assertDraft(db, countId);
  await db
    .update(schema.inventoryCounts)
    .set({ status: "voided" })
    .where(eq(schema.inventoryCounts.id, countId));
}
