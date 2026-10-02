import { allocateFefo, type LotBalance } from "@chipa/domain";
import { and, asc, eq, gt, inArray, schema, sql, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";

/**
 * Núcleo del libro mayor de stock (ADR 004). Lo usan compras (recepción), producción (consumo y
 * envasado), despacho, local e inventario. Ningún módulo inserta en stock_movements por otro camino.
 */
export type MovementType = (typeof schema.stockMovementTypeEnum.enumValues)[number];

interface BaseMovement {
  type: MovementType;
  locationId: string;
  /** + entra / − sale */
  qty: number;
  refTable?: string | null;
  refId?: string | null;
  note?: string | null;
  occurredAt?: Date;
}
export type IngredientMovement = BaseMovement & { ingredientId: string; rawLotId?: string | null };
export type ProductMovement = BaseMovement & { productId: string; finishedLotId?: string | null };

export async function recordIngredientMovements(
  db: Executor,
  userId: string | null,
  moves: IngredientMovement[],
) {
  if (!moves.length) return;
  await db.insert(schema.stockMovements).values(
    moves.map((m) => ({
      type: m.type,
      itemKind: "ingredient" as const,
      ingredientId: m.ingredientId,
      rawLotId: m.rawLotId ?? null,
      locationId: m.locationId,
      qty: m.qty,
      refTable: m.refTable ?? null,
      refId: m.refId ?? null,
      note: m.note ?? null,
      occurredAt: m.occurredAt ?? new Date(),
      createdById: userId,
    })),
  );
}

export async function recordProductMovements(db: Executor, userId: string | null, moves: ProductMovement[]) {
  if (!moves.length) return;
  await db.insert(schema.stockMovements).values(
    moves.map((m) => ({
      type: m.type,
      itemKind: "product" as const,
      productId: m.productId,
      finishedLotId: m.finishedLotId ?? null,
      locationId: m.locationId,
      qty: m.qty,
      refTable: m.refTable ?? null,
      refId: m.refId ?? null,
      note: m.note ?? null,
      occurredAt: m.occurredAt ?? new Date(),
      createdById: userId,
    })),
  );
}

/** Saldo total por insumo (todas las ubicaciones y lotes). */
export async function ingredientTotals(db: Executor): Promise<Record<string, number>> {
  const rows = await db
    .select({
      ingredientId: schema.ingredientStock.ingredientId,
      qty: sql<number>`sum(${schema.ingredientStock.qty})`.mapWith(Number),
    })
    .from(schema.ingredientStock)
    .groupBy(schema.ingredientStock.ingredientId);
  return Object.fromEntries(rows.map((r) => [r.ingredientId, r.qty]));
}

/** Lotes de materia prima con saldo de un insumo (para consumo FEFO o elección manual). */
export async function rawLotBalances(db: Executor, ingredientId: string) {
  return db
    .select({
      rawLotId: schema.ingredientStock.rawLotId,
      locationId: schema.ingredientStock.locationId,
      qty: schema.ingredientStock.qty,
      supplierLotCode: schema.rawLots.supplierLotCode,
      expiryDate: schema.rawLots.expiryDate,
      receivedAt: schema.rawLots.createdAt,
    })
    .from(schema.ingredientStock)
    .leftJoin(schema.rawLots, eq(schema.rawLots.id, schema.ingredientStock.rawLotId))
    .where(and(eq(schema.ingredientStock.ingredientId, ingredientId), gt(schema.ingredientStock.qty, 0)))
    .orderBy(asc(schema.rawLots.expiryDate));
}

/** Lotes terminados con saldo de un producto, excluyendo retenidos por calidad. */
export async function finishedLotBalances(
  db: Executor,
  productId: string,
  opts: { locationIds?: string[] } = {},
) {
  return db
    .select({
      finishedLotId: schema.productStock.finishedLotId,
      locationId: schema.productStock.locationId,
      qty: schema.productStock.qty,
      code: schema.finishedLots.code,
      expiryDate: schema.finishedLots.expiryDate,
    })
    .from(schema.productStock)
    .innerJoin(schema.finishedLots, eq(schema.finishedLots.id, schema.productStock.finishedLotId))
    .where(
      and(
        eq(schema.productStock.productId, productId),
        gt(schema.productStock.qty, 0),
        eq(schema.finishedLots.onHold, false),
        opts.locationIds?.length ? inArray(schema.productStock.locationId, opts.locationIds) : undefined,
      ),
    )
    .orderBy(asc(schema.finishedLots.expiryDate));
}

/**
 * Asigna unidades de un producto por FEFO (Regla 5) entre lotes y ubicaciones.
 * Lanza UserError si no alcanza, salvo `allowShortfall`.
 */
export async function allocateProductFefo(
  db: Executor,
  productId: string,
  units: number,
  opts: { locationIds?: string[]; allowShortfall?: boolean } = {},
) {
  const balances = await finishedLotBalances(db, productId, opts);
  // Cada (lote, ubicación) es una "posición" para FEFO.
  const positions: LotBalance[] = balances.map((b) => ({
    lotId: `${b.finishedLotId}|${b.locationId}`,
    expiryDate: b.expiryDate,
    qty: b.qty,
    locationId: b.locationId,
  }));
  const { allocations, shortfall } = allocateFefo(positions, units);
  if (shortfall > 0 && !opts.allowShortfall) {
    throw new UserError(`No hay stock suficiente: faltan ${shortfall} unidades.`);
  }
  return {
    shortfall,
    allocations: allocations.map((a) => {
      const [finishedLotId, locationId] = a.lotId.split("|") as [string, string];
      const b = balances.find((x) => x.finishedLotId === finishedLotId && x.locationId === locationId)!;
      return { finishedLotId, locationId, qty: a.qty, code: b.code, expiryDate: b.expiryDate };
    }),
  };
}

/** Ubicación por código (F3, F4, LOCAL, VEHICULO, HELADERA, DEP-SECO). */
export async function locationByCode(db: Executor, code: string) {
  const loc = await db.query.locations.findFirst({ where: eq(schema.locations.code, code) });
  if (!loc) throw new Error(`ubicación ${code} no existe`);
  return loc;
}
