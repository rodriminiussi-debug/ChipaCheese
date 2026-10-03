import { roundQty } from "@chipa/domain";
import type * as s from "../../schema";
import { stamp, type Ctx, type FinLoc, type FinishedPos, type RawLotState } from "./ctx";

type MovementType = (typeof s.stockMovementTypeEnum.enumValues)[number];

interface MoveBase {
  at: Date;
  type: MovementType;
  qty: number;
  refTable?: string | null;
  refId?: string | null;
  note?: string | null;
  by?: string | null;
}

/** Movimiento de materia prima en el libro mayor. */
export function moveIngredient(ctx: Ctx, m: MoveBase & { ing: string; lotId: string | null; loc: string }) {
  ctx.buf.stockMovements.push({
    id: ctx.rng.uuid(),
    occurredAt: m.at,
    type: m.type,
    itemKind: "ingredient",
    ingredientId: ctx.ingId[m.ing]!,
    rawLotId: m.lotId,
    locationId: ctx.loc[m.loc]!,
    qty: roundQty(m.qty),
    refTable: m.refTable ?? null,
    refId: m.refId ?? null,
    note: m.note ?? null,
    createdById: m.by ?? null,
    ...stamp(m.at),
  });
}

/** Movimiento de producto terminado en el libro mayor. */
export function moveProduct(ctx: Ctx, m: MoveBase & { product: string; lotId: string; loc: FinLoc }) {
  ctx.buf.stockMovements.push({
    id: ctx.rng.uuid(),
    occurredAt: m.at,
    type: m.type,
    itemKind: "product",
    productId: ctx.products[m.product]!.id,
    finishedLotId: m.lotId,
    locationId: ctx.loc[m.loc]!,
    qty: roundQty(m.qty),
    refTable: m.refTable ?? null,
    refId: m.refId ?? null,
    note: m.note ?? null,
    createdById: m.by ?? null,
    ...stamp(m.at),
  });
}

// --- Materia prima ----------------------------------------------------------------------------

export function rawLotsOf(ctx: Ctx, ing: string): RawLotState[] {
  return (ctx.rawLots[ing] ??= []);
}

export function rawStock(ctx: Ctx, ing: string): number {
  return roundQty(rawLotsOf(ctx, ing).reduce((a, l) => a + l.qty, 0));
}

/** Lotes con saldo ordenados FEFO (vence primero, sale primero; sin vencimiento por antigüedad). */
export function fefoRaw(ctx: Ctx, ing: string): RawLotState[] {
  return rawLotsOf(ctx, ing)
    .filter((l) => l.qty > 0.0005)
    .sort(
      (a, b) =>
        (a.expiry ?? "9999-12-31").localeCompare(b.expiry ?? "9999-12-31") ||
        a.receivedAt.getTime() - b.receivedAt.getTime(),
    );
}

/** Descuenta `qty` de la materia prima por FEFO. Devuelve lo asignado por lote; null si no alcanza. */
export function takeRaw(ctx: Ctx, ing: string, qty: number): { lot: RawLotState; qty: number }[] | null {
  if (rawStock(ctx, ing) + 0.0005 < qty) return null;
  let rest = roundQty(qty);
  const out: { lot: RawLotState; qty: number }[] = [];
  for (const lot of fefoRaw(ctx, ing)) {
    if (rest <= 0.0004) break;
    const take = roundQty(Math.min(lot.qty, rest));
    lot.qty = roundQty(lot.qty - take);
    rest = roundQty(rest - take);
    out.push({ lot, qty: take });
  }
  return out;
}

// --- Producto terminado ---------------------------------------------------------------------------

export function finishedStock(ctx: Ctx, product: string, locs: FinLoc[]): number {
  return ctx.finishedPos
    .filter((p) => p.product === product && locs.includes(p.loc))
    .reduce((a, p) => a + p.qty, 0);
}

/** Posición (lote × ubicación) del producto; la crea si no existe. */
export function finishedPosition(
  ctx: Ctx,
  product: string,
  lotId: string,
  loc: FinLoc,
  create = true,
): FinishedPos | undefined {
  let pos = ctx.finishedPos.find((p) => p.product === product && p.lot.id === lotId && p.loc === loc);
  if (!pos && create) {
    const lot = ctx.finishedLots.find((l) => l.id === lotId)!;
    pos = { lot, product, loc, qty: 0 };
    ctx.finishedPos.push(pos);
  }
  return pos;
}

/** Asignación FEFO de unidades entre posiciones; null si el stock no alcanza (no toca nada). */
export function allocateFinished(
  ctx: Ctx,
  product: string,
  units: number,
  locs: FinLoc[],
): { pos: FinishedPos; qty: number }[] | null {
  const candidates = ctx.finishedPos
    .filter((p) => p.product === product && locs.includes(p.loc) && p.qty > 0)
    .sort((a, b) => a.lot.expiry.localeCompare(b.lot.expiry) || a.lot.code.localeCompare(b.lot.code));
  let rest = units;
  const out: { pos: FinishedPos; qty: number }[] = [];
  for (const pos of candidates) {
    if (rest <= 0) break;
    const take = Math.min(pos.qty, rest);
    out.push({ pos, qty: take });
    rest -= take;
  }
  return rest > 0 ? null : out;
}
