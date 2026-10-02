import { asc, desc, eq, schema, type Executor } from "@chipa/db";
import { monthlyPriceSeries, priceVariationPct, purchaseVariations } from "@chipa/domain";

/** Historial de precios por insumo y proveedor (RF-09). Precios netos, sin IVA. */

export interface LatestPrice {
  ingredientId: string;
  supplierId: string | null;
  date: string;
  /** Precio unitario SIN IVA en la unidad del insumo. */
  unitPriceNet: number;
}

/**
 * Último precio de compra (sin IVA) de cada insumo, indexado por `ingredientId`.
 * Lo consume el costeo (M8, Regla 8). Sale de la vista `v_ingredient_last_price`.
 */
export async function getLatestPrices(db: Executor): Promise<Record<string, LatestPrice>> {
  const rows = await db.select().from(schema.ingredientLastPrice);
  return Object.fromEntries(
    rows.map((r) => [
      r.ingredientId,
      { ingredientId: r.ingredientId, supplierId: r.supplierId, date: r.date, unitPriceNet: r.unitPriceNet },
    ]),
  );
}

/** Todas las compras de un insumo, con proveedor y variación contra la compra anterior del mismo proveedor. */
export async function ingredientPriceHistory(db: Executor, ingredientId: string) {
  const ingredient = await db.query.ingredients.findFirst({ where: eq(schema.ingredients.id, ingredientId) });
  if (!ingredient) return null;
  const p = schema.ingredientPrices;
  const rows = await db
    .select({
      id: p.id,
      date: p.date,
      supplierId: p.supplierId,
      supplierName: schema.suppliers.legalName,
      unitPriceNet: p.unitPriceNet,
      invoiceId: schema.purchaseInvoiceItems.invoiceId,
    })
    .from(p)
    .leftJoin(schema.suppliers, eq(schema.suppliers.id, p.supplierId))
    .leftJoin(schema.purchaseInvoiceItems, eq(schema.purchaseInvoiceItems.id, p.invoiceItemId))
    .where(eq(p.ingredientId, ingredientId))
    .orderBy(asc(p.date), asc(p.createdAt));

  // Variación por proveedor (cada serie contra su compra anterior).
  const seriesKey = (s: string | null) => s ?? "none";
  const series = new Map<string, typeof rows>();
  for (const r of rows) series.set(seriesKey(r.supplierId), [...(series.get(seriesKey(r.supplierId)) ?? []), r]);
  const variationById = new Map<string, number | null>();
  for (const list of series.values()) {
    const vars = purchaseVariations(list.map((r) => ({ date: r.date, price: r.unitPriceNet })));
    list.forEach((r, i) => variationById.set(r.id, vars[i] ?? null));
  }

  const history = rows.map((r) => ({
    ...r,
    supplierName: r.supplierName ?? "Sin proveedor",
    variationPct: variationById.get(r.id) ?? null,
  }));

  const suppliers = [...series.entries()].map(([key, list]) => {
    const last = list[list.length - 1]!;
    return {
      supplierId: last.supplierId,
      key,
      name: last.supplierName ?? "Sin proveedor",
      lastPrice: last.unitPriceNet,
      lastDate: last.date,
      purchases: list.length,
      points: list.map((r) => ({ date: r.date, price: r.unitPriceNet })),
    };
  });
  const cheapest = suppliers.length ? Math.min(...suppliers.map((s) => s.lastPrice)) : null;

  return {
    ingredient,
    /** Más reciente primero (para la tabla). */
    history: [...history].reverse(),
    suppliers: suppliers
      .sort((a, b) => a.lastPrice - b.lastPrice)
      .map((s) => ({
        ...s,
        vsCheapestPct: cheapest != null && s.lastPrice !== cheapest ? priceVariationPct(cheapest, s.lastPrice) : 0,
      })),
    /** Último precio de cada mes (cualquier proveedor) con su variación mensual. */
    monthly: monthlyPriceSeries(rows.map((r) => ({ date: r.date, price: r.unitPriceNet }))),
  };
}
export type IngredientPriceHistory = NonNullable<Awaited<ReturnType<typeof ingredientPriceHistory>>>;

/** Resumen por insumo: último precio, variación vs la compra anterior y cantidad de proveedores. */
export async function priceOverview(db: Executor) {
  const [ingredients, prices] = await Promise.all([
    db.query.ingredients.findMany({ where: eq(schema.ingredients.active, true), orderBy: asc(schema.ingredients.name) }),
    db
      .select({
        ingredientId: schema.ingredientPrices.ingredientId,
        supplierId: schema.ingredientPrices.supplierId,
        supplierName: schema.suppliers.legalName,
        date: schema.ingredientPrices.date,
        unitPriceNet: schema.ingredientPrices.unitPriceNet,
      })
      .from(schema.ingredientPrices)
      .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.ingredientPrices.supplierId))
      .orderBy(
        desc(schema.ingredientPrices.date),
        desc(schema.ingredientPrices.createdAt),
      ),
  ]);
  const byIngredient = new Map<string, typeof prices>();
  for (const r of prices) byIngredient.set(r.ingredientId, [...(byIngredient.get(r.ingredientId) ?? []), r]);
  return ingredients.map((ing) => {
    const list = byIngredient.get(ing.id) ?? [];
    const last = list[0];
    // Compra anterior = la más reciente previa del mismo proveedor.
    const previous = last ? list.slice(1).find((r) => r.supplierId === last.supplierId) : undefined;
    return {
      ingredientId: ing.id,
      name: ing.name,
      unit: ing.unit,
      lastPrice: last?.unitPriceNet ?? null,
      lastDate: last?.date ?? null,
      supplierName: last?.supplierName ?? null,
      variationPct: last && previous ? priceVariationPct(previous.unitPriceNet, last.unitPriceNet) : null,
      suppliers: new Set(list.map((r) => r.supplierId)).size,
    };
  });
}
