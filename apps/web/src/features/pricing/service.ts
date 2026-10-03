import { marginPct, marginPerUnit, priceForMargin, currentUnitPrice, type IsoDate } from "@chipa/domain";
import { asc, eq, schema, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import { todayAR } from "@/lib/dates";
import { getProductCosts, type ProductCosts } from "@/features/costing/service";
import type { ApplySuggestedData, SetPriceData, TargetMarginData } from "./schemas";

/**
 * RF-29: listas de precios por canal con margen sobre el costo directo actual (Reglas 8 y 9).
 * Los precios se versionan por vigencia: editar agrega una fila `price_list_items` y conserva el historial.
 */

export type PriceStatus = "ok" | "below_target" | "below_cost" | "no_price" | "no_cost";

export interface PriceHistoryEntry {
  validFrom: IsoDate;
  unitPrice: number;
}

export interface PriceRow {
  productId: string;
  code: string;
  name: string;
  presentation: string;
  /** Precio vigente a hoy; null si el producto no tiene precio en la lista. */
  price: number | null;
  validFrom: IsoDate | null;
  /** Próximo cambio programado (vigencia futura). */
  upcoming: PriceHistoryEntry | null;
  /** Costo directo por unidad; null si falta algún precio de compra. */
  cost: number | null;
  missingPrices: string[];
  marginPct: number | null;
  marginPerUnit: number | null;
  /** Precio que cumple el margen objetivo de la lista (costo ÷ (1 − margen)). */
  suggestedPrice: number | null;
  status: PriceStatus;
  history: PriceHistoryEntry[];
}

export interface PriceListView {
  id: string;
  name: string;
  channel: string;
  targetMarginPct: number;
  rows: PriceRow[];
  belowTarget: number;
  belowCost: number;
}

function rowStatus(price: number | null, cost: number | null, target: number): PriceStatus {
  if (price == null) return "no_price";
  if (cost == null) return "no_cost";
  if (price < cost) return "below_cost";
  return marginPct(price, cost) < target ? "below_target" : "ok";
}

/** Matriz lista × producto con costo, margen y precio sugerido. */
export async function getPriceMatrix(db: Executor, today: IsoDate = todayAR(), costs?: ProductCosts) {
  const [lists, items, products, cost] = await Promise.all([
    db.query.priceLists.findMany({
      where: eq(schema.priceLists.active, true),
      orderBy: asc(schema.priceLists.name),
    }),
    db.select().from(schema.priceListItems),
    db.query.products.findMany({
      where: eq(schema.products.active, true),
      orderBy: asc(schema.products.code),
    }),
    costs ?? getProductCosts(db, today),
  ]);

  const byKey = new Map<string, PriceHistoryEntry[]>();
  for (const i of items) {
    const key = `${i.priceListId}|${i.productId}`;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push({ validFrom: i.validFrom, unitPrice: i.unitPrice });
  }

  const views: PriceListView[] = lists.map((l) => {
    const rows: PriceRow[] = products.map((p) => {
      const history = (byKey.get(`${l.id}|${p.id}`) ?? []).sort((a, b) =>
        a.validFrom < b.validFrom ? 1 : -1,
      );
      const price = currentUnitPrice(history, today);
      const current = history.find((h) => h.validFrom <= today) ?? null;
      const upcomingList = history.filter((h) => h.validFrom > today);
      const upcoming = upcomingList.length ? upcomingList[upcomingList.length - 1]! : null;
      const pc = cost.byProductId[p.id];
      const unitCost = pc?.unitCost ?? null;
      const status = rowStatus(price, unitCost, l.targetMarginPct);
      return {
        productId: p.id,
        code: p.code,
        name: p.name,
        presentation: p.presentation,
        price,
        validFrom: current?.validFrom ?? null,
        upcoming,
        cost: unitCost,
        missingPrices: pc?.missingPrices ?? [],
        marginPct: price != null && price > 0 && unitCost != null ? marginPct(price, unitCost) : null,
        marginPerUnit: price != null && unitCost != null ? marginPerUnit(price, unitCost) : null,
        suggestedPrice: unitCost != null ? priceForMargin(unitCost, l.targetMarginPct) : null,
        status,
        history,
      };
    });
    return {
      id: l.id,
      name: l.name,
      channel: l.channel,
      targetMarginPct: l.targetMarginPct,
      rows,
      belowTarget: rows.filter((r) => r.status === "below_target").length,
      belowCost: rows.filter((r) => r.status === "below_cost").length,
    };
  });
  return { lists: views, costs: cost };
}
export type PriceMatrix = Awaited<ReturnType<typeof getPriceMatrix>>;

/** Nueva fila de precio con vigencia. Si ya hay una fila con esa vigencia, la corrige. */
export async function setPrice(db: Executor, input: SetPriceData, today: IsoDate = todayAR()) {
  const validFrom = input.validFrom ?? today;
  if (validFrom < today)
    throw new UserError("La vigencia no puede ser anterior a hoy.", { validFrom: ["Fecha pasada"] });
  const [list, product] = await Promise.all([
    db.query.priceLists.findFirst({ where: eq(schema.priceLists.id, input.priceListId) }),
    db.query.products.findFirst({ where: eq(schema.products.id, input.productId) }),
  ]);
  if (!list) throw new UserError("La lista de precios no existe.");
  if (!product) throw new UserError("El producto no existe.");
  const t = schema.priceListItems;
  const [row] = await db
    .insert(t)
    .values({ priceListId: list.id, productId: product.id, unitPrice: input.unitPrice, validFrom })
    .onConflictDoUpdate({
      target: [t.priceListId, t.productId, t.validFrom],
      set: { unitPrice: input.unitPrice },
    })
    .returning();
  return row!;
}

/** Margen objetivo de la lista (Regla 9). */
export async function updateTargetMargin(db: Executor, input: TargetMarginData) {
  const [row] = await db
    .update(schema.priceLists)
    .set({ targetMarginPct: input.targetMarginPct })
    .where(eq(schema.priceLists.id, input.priceListId))
    .returning();
  if (!row) throw new UserError("La lista de precios no existe.");
  return row;
}

/**
 * Aplica el precio sugerido (priceForMargin) a los productos de la lista cuyo margen está bajo el objetivo
 * y cuyo costo se conoce. Nunca baja precios. Devuelve los cambios hechos.
 */
export async function applySuggestedPrices(
  db: Executor,
  input: ApplySuggestedData,
  today: IsoDate = todayAR(),
) {
  const { lists } = await getPriceMatrix(db, today);
  const list = lists.find((l) => l.id === input.priceListId);
  if (!list) throw new UserError("La lista de precios no existe o está inactiva.");
  const only = input.productIds?.length ? new Set(input.productIds) : null;
  const targets = list.rows.filter(
    (r) =>
      (r.status === "below_target" || r.status === "below_cost") &&
      r.suggestedPrice != null &&
      r.price != null &&
      r.suggestedPrice > r.price &&
      (!only || only.has(r.productId)),
  );
  if (targets.length === 0) throw new UserError("No hay precios bajo el margen objetivo para actualizar.");
  const changes: { productId: string; name: string; from: number; to: number }[] = [];
  for (const r of targets) {
    await setPrice(
      db,
      {
        priceListId: list.id,
        productId: r.productId,
        unitPrice: r.suggestedPrice!,
        validFrom: input.validFrom,
      },
      today,
    );
    changes.push({ productId: r.productId, name: r.name, from: r.price!, to: r.suggestedPrice! });
  }
  return { priceListId: list.id, changes };
}

/** Productos con precio por debajo del costo en alguna lista (alerta fuerte; la reutiliza M8). */
export async function getBelowCostPrices(db: Executor, today: IsoDate = todayAR()) {
  const { lists } = await getPriceMatrix(db, today);
  return lists.flatMap((l) =>
    l.rows
      .filter((r) => r.status === "below_cost")
      .map((r) => ({
        listId: l.id,
        listName: l.name,
        productId: r.productId,
        name: r.name,
        price: r.price!,
        cost: r.cost!,
      })),
  );
}
