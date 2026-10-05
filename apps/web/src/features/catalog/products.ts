import { roundQty, type IsoDate } from "@chipa/domain";
import { and, asc, eq, ilike, inArray, ne, or, schema, sql, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import { todayAR } from "@/lib/dates";
import { getProductCosts } from "@/features/costing/service";
import { getPriceMatrix } from "@/features/pricing/service";
import type { CostReference } from "./preview";
import type { ProductData, UpdateProductData } from "./schemas";

/**
 * Catálogo de productos: alta y edición guiada según el tipo.
 *  - fabricado: sale de la masa en planta (lote y vencimiento); sus componentes son envase, etiqueta, rellenos.
 *  - reventa: se compra y se vende tal cual (gaseosas…); su costo es el último de compra.
 *  - elaborado en el local: consume unidades de un producto base fabricado al venderse.
 */

export type ProductKind = "manufactured" | "resale" | "prepared";

export interface ProductListFilter {
  kind?: ProductKind;
  q?: string;
  /** Por defecto solo activos. */
  status?: "active" | "inactive" | "all";
}

export async function listProducts(db: Executor, f: ProductListFilter = {}) {
  const p = schema.products;
  const q = f.q?.trim();
  const rows = await db.query.products.findMany({
    where: and(
      f.kind ? eq(p.kind, f.kind) : undefined,
      (f.status ?? "active") === "all" ? undefined : eq(p.active, (f.status ?? "active") === "active"),
      q ? or(ilike(p.name, `%${q}%`), ilike(p.code, `%${q}%`), ilike(p.barcode, `%${q}%`)) : undefined,
    ),
    orderBy: [asc(p.kind), asc(p.code)],
    with: { baseProduct: true, defaultSupplier: true },
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    unitLabel: r.unitLabel,
    barcode: r.barcode,
    netWeightKg: r.netWeightKg,
    presentation: r.presentation,
    shape: r.shape,
    active: r.active,
    availableInStore: r.availableInStore,
    availableForOrders: r.availableForOrders,
    baseName: r.baseProduct?.name ?? null,
    baseQty: r.baseQty,
    supplierName: r.defaultSupplier?.tradeName ?? r.defaultSupplier?.legalName ?? null,
  }));
}
export type ProductListRow = Awaited<ReturnType<typeof listProducts>>[number];

export async function getProduct(db: Executor, id: string) {
  const row = await db.query.products.findFirst({
    where: eq(schema.products.id, id),
    with: { components: { with: { ingredient: true } }, baseProduct: true, defaultSupplier: true },
  });
  return row ?? null;
}

/**
 * Datos para el formulario: insumos con su último precio, proveedores, listas de precios y productos base
 * posibles, más la referencia de costos para calcular el costo/margen estimado mientras se carga.
 */
export async function productFormOptions(db: Executor, today: IsoDate = todayAR()) {
  const [ingredients, suppliers, priceLists, bases, prices] = await Promise.all([
    db.query.ingredients.findMany({
      where: eq(schema.ingredients.active, true),
      orderBy: asc(schema.ingredients.name),
    }),
    db.query.suppliers.findMany({
      where: eq(schema.suppliers.active, true),
      orderBy: asc(schema.suppliers.legalName),
    }),
    db.query.priceLists.findMany({
      where: eq(schema.priceLists.active, true),
      orderBy: asc(schema.priceLists.name),
    }),
    db.query.products.findMany({
      where: and(eq(schema.products.active, true), eq(schema.products.kind, "manufactured")),
      orderBy: asc(schema.products.code),
    }),
    db.select().from(schema.ingredientLastPrice),
  ]);
  let costPerKg: number | null = null;
  const baseCosts: Record<string, number | null> = {};
  try {
    const costs = await getProductCosts(db, today);
    costPerKg = costs.costPerKg;
    for (const b of bases) baseCosts[b.id] = costs.byProductId[b.id]?.unitCost ?? null;
  } catch (e) {
    // Sin receta activa no hay costo: el formulario avisa que falta el dato en vez de asumir $0.
    if (!(e instanceof UserError)) throw e;
    for (const b of bases) baseCosts[b.id] = null;
  }
  const reference: CostReference = {
    costPerKg,
    ingredientPrices: Object.fromEntries(prices.map((x) => [x.ingredientId, x.unitPriceNet])),
    baseCosts,
    ingredientNames: Object.fromEntries(ingredients.map((i) => [i.id, i.name])),
  };
  return {
    ingredients: ingredients.map((i) => ({ id: i.id, name: i.name, unit: i.unit })),
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.tradeName ?? s.legalName })),
    priceLists: priceLists.map((l) => ({
      id: l.id,
      name: l.name,
      channel: l.channel,
      targetMarginPct: l.targetMarginPct,
    })),
    baseProducts: bases.map((b) => ({ id: b.id, code: b.code, name: b.name, netWeightKg: b.netWeightKg })),
    reference,
  };
}
export type ProductFormOptions = Awaited<ReturnType<typeof productFormOptions>>;

// --- Validaciones ----------------------------------------------------------------------------------

async function assertUnique(db: Executor, v: { code: string; barcode: string | null }, exceptId?: string) {
  const p = schema.products;
  const sameCode = await db.query.products.findFirst({
    where: and(sql`lower(${p.code}) = lower(${v.code})`, exceptId ? ne(p.id, exceptId) : undefined),
  });
  if (sameCode)
    throw new UserError(`Ya existe un producto con el código ${sameCode.code} (${sameCode.name}).`, {
      code: ["Código repetido"],
    });
  if (v.barcode) {
    const sameBarcode = await db.query.products.findFirst({
      where: and(eq(p.barcode, v.barcode), exceptId ? ne(p.id, exceptId) : undefined),
    });
    if (sameBarcode)
      throw new UserError(`Ese código de barras ya lo tiene ${sameBarcode.name}.`, {
        barcode: ["Código de barras repetido"],
      });
  }
}

/** El producto base de un elaborado: un fabricado activo, distinto del propio elaborado. */
async function loadBase(db: Executor, baseId: string, selfId?: string, requireActive = true) {
  if (selfId && baseId === selfId)
    throw new UserError("Un producto no puede ser su propio producto base.", {
      baseProductId: ["No puede ser el mismo producto"],
    });
  const base = await db.query.products.findFirst({ where: eq(schema.products.id, baseId) });
  if (!base) throw new UserError("El producto base no existe.", { baseProductId: ["Producto inexistente"] });
  if (base.kind !== "manufactured")
    throw new UserError(
      `El producto base tiene que ser un producto fabricado: ${base.name} es ${base.kind === "prepared" ? "un elaborado en el local" : "de reventa"}.`,
      { baseProductId: ["Elegí un producto fabricado"] },
    );
  if (requireActive && !base.active)
    throw new UserError(`${base.name} está inactivo: elegí un producto base activo.`, {
      baseProductId: ["Producto inactivo"],
    });
  return base;
}

async function assertIngredientsExist(db: Executor, ids: string[]) {
  if (!ids.length) return;
  const found = await db.query.ingredients.findMany({ where: inArray(schema.ingredients.id, ids) });
  if (found.length !== new Set(ids).size)
    throw new UserError("Hay un insumo inexistente en los componentes.");
  const inactive = found.find((i) => !i.active);
  if (inactive) throw new UserError(`El insumo ${inactive.name} está inactivo.`);
}

async function assertSupplierExists(db: Executor, id: string | null) {
  if (!id) return;
  const s = await db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, id) });
  if (!s) throw new UserError("El proveedor no existe.", { defaultSupplierId: ["Proveedor inexistente"] });
}

/** Columnas de `products` según el tipo: cada tipo fija lo que no le corresponde. */
async function productColumns(
  db: Executor,
  v: ProductData | UpdateProductData,
  selfId?: string,
  /** En una edición, el base que ya tenía puede seguir aunque se haya desactivado después. */
  keepBaseId?: string | null,
) {
  await assertUnique(db, v, selfId);
  await assertSupplierExists(db, v.defaultSupplierId);
  const common = {
    code: v.code,
    name: v.name,
    kind: v.kind,
    unitLabel: v.unitLabel,
    barcode: v.barcode,
    description: v.description,
    minStockUnits: v.minStockUnits,
    availableInStore: v.availableInStore,
    active: v.active,
  };
  if (v.kind === "manufactured") {
    await assertIngredientsExist(
      db,
      v.components.map((c) => c.ingredientId),
    );
    return {
      ...common,
      shape: v.shape,
      presentation: v.presentation,
      netWeightKg: v.netWeightKg!,
      baseProductId: null,
      baseQty: null,
      defaultSupplierId: null,
      boardCode: v.boardCode,
      availableForOrders: v.availableForOrders,
    };
  }
  if (v.kind === "resale") {
    return {
      ...common,
      shape: "other" as const,
      presentation: "unit" as const,
      netWeightKg: 0,
      baseProductId: null,
      baseQty: null,
      defaultSupplierId: v.defaultSupplierId,
      boardCode: null,
      // La reventa no tiene lote: no se despacha en pedidos mayoristas.
      availableForOrders: false,
    };
  }
  const base = await loadBase(db, v.baseProductId!, selfId, v.baseProductId !== keepBaseId);
  await assertIngredientsExist(
    db,
    v.components.map((c) => c.ingredientId),
  );
  return {
    ...common,
    shape: "other" as const,
    presentation: "unit" as const,
    // Equivalente en masa: lo cargado o, si no, lo que consume del producto base.
    netWeightKg: v.netWeightKg != null ? v.netWeightKg : roundQty(v.baseQty! * base.netWeightKg),
    baseProductId: base.id,
    baseQty: v.baseQty!,
    defaultSupplierId: null,
    boardCode: null,
    availableForOrders: false,
  };
}

// --- Altas y cambios -------------------------------------------------------------------------------

export async function createProduct(db: Executor, input: ProductData, today: IsoDate = todayAR()) {
  const cols = await productColumns(db, input);
  const [row] = await db.insert(schema.products).values(cols).returning();
  const product = row!;
  const components = input.kind === "resale" ? [] : input.components;
  if (components.length)
    await db.insert(schema.productComponents).values(
      components.map((c) => ({
        productId: product.id,
        ingredientId: c.ingredientId,
        qtyPerUnit: c.qtyPerUnit,
      })),
    );
  if (input.kind === "resale" && input.initialCost != null)
    await db.insert(schema.productCosts).values({
      productId: product.id,
      supplierId: input.defaultSupplierId,
      date: today,
      unitCostNet: input.initialCost,
    });
  const prices = input.initialPrices.filter((p) => p.unitPrice != null);
  if (prices.length) {
    const lists = await db.query.priceLists.findMany({
      where: inArray(
        schema.priceLists.id,
        prices.map((p) => p.priceListId),
      ),
    });
    if (lists.length !== new Set(prices.map((p) => p.priceListId)).size)
      throw new UserError("Hay una lista de precios inexistente.");
    await db.insert(schema.priceListItems).values(
      prices.map((p) => ({
        priceListId: p.priceListId,
        productId: product.id,
        unitPrice: p.unitPrice!,
        validFrom: today,
      })),
    );
  }
  return product;
}

/** Productos elaborados activos que consumen a `baseId`. */
async function activePreparedUsing(db: Executor, baseId: string) {
  return db.query.products.findMany({
    where: and(
      eq(schema.products.baseProductId, baseId),
      eq(schema.products.kind, "prepared"),
      eq(schema.products.active, true),
    ),
  });
}

async function assertCanDeactivate(db: Executor, id: string) {
  const dependants = await activePreparedUsing(db, id);
  if (dependants.length)
    throw new UserError(
      `No se puede desactivar: es el producto base de ${dependants.map((d) => d.name).join(", ")}. Desactivá o cambiá primero esos productos.`,
    );
}

export async function updateProduct(db: Executor, input: UpdateProductData) {
  const current = await db.query.products.findFirst({ where: eq(schema.products.id, input.id) });
  if (!current) throw new UserError("El producto no existe.");
  if (current.kind !== input.kind)
    throw new UserError("El tipo de producto no se puede cambiar: creá uno nuevo con el tipo correcto.", {
      kind: ["No se puede cambiar el tipo"],
    });
  if (current.active && !input.active) await assertCanDeactivate(db, current.id);
  const cols = await productColumns(db, input, current.id, current.baseProductId);
  const [row] = await db
    .update(schema.products)
    .set(cols)
    .where(eq(schema.products.id, current.id))
    .returning();
  await db.delete(schema.productComponents).where(eq(schema.productComponents.productId, current.id));
  const components = input.kind === "resale" ? [] : input.components;
  if (components.length)
    await db.insert(schema.productComponents).values(
      components.map((c) => ({
        productId: current.id,
        ingredientId: c.ingredientId,
        qtyPerUnit: c.qtyPerUnit,
      })),
    );
  return row!;
}

export async function setProductActive(db: Executor, id: string, active: boolean) {
  const current = await db.query.products.findFirst({ where: eq(schema.products.id, id) });
  if (!current) throw new UserError("El producto no existe.");
  if (!active && current.active) await assertCanDeactivate(db, id);
  if (active && current.kind === "prepared" && current.baseProductId) {
    await loadBase(db, current.baseProductId, id);
  }
  const [row] = await db
    .update(schema.products)
    .set({ active })
    .where(eq(schema.products.id, id))
    .returning();
  return row!;
}

/** Código de error de Postgres de una excepción de Drizzle/postgres.js (puede venir en `cause`). */
export function pgErrorCode(e: unknown): string | undefined {
  const x = e as { code?: string; cause?: { code?: string } } | null;
  return x?.code ?? x?.cause?.code;
}

/**
 * Borra un producto sin movimientos (alta equivocada). Si ya tiene stock, ventas, pedidos, remitos, costos de
 * facturas o es base de otro producto, no se borra: se desactiva. Los precios y el costo inicial cargados al
 * crearlo se borran junto con él.
 */
export async function deleteProduct(db: Executor, id: string) {
  const product = await db.query.products.findFirst({ where: eq(schema.products.id, id) });
  if (!product) throw new UserError("El producto no existe.");
  try {
    await db.transaction(async (tx) => {
      await tx.delete(schema.priceListItems).where(eq(schema.priceListItems.productId, id));
      await tx.delete(schema.productCosts).where(eq(schema.productCosts.productId, id));
      await tx.delete(schema.products).where(eq(schema.products.id, id));
    });
  } catch (e) {
    if (pgErrorCode(e) === "23503")
      throw new UserError(
        `"${product.name}" ya tiene movimientos (stock, ventas, pedidos o compras) y no se puede borrar. Desactivalo para que deje de ofrecerse.`,
      );
    throw e;
  }
  return { id };
}

/** Costo actual y precio/margen del producto en cada lista (para la ficha). null si no hay receta activa. */
export async function productPricing(db: Executor, productId: string, today: IsoDate = todayAR()) {
  try {
    const { lists, costs } = await getPriceMatrix(db, today);
    const cost = costs.byProductId[productId];
    return {
      cost: cost?.unitCost ?? null,
      missingPrices: cost?.missingPrices ?? [],
      lists: lists.flatMap((l) => {
        const r = l.rows.find((x) => x.productId === productId);
        return r
          ? [
              {
                id: l.id,
                name: l.name,
                targetMarginPct: l.targetMarginPct,
                price: r.price,
                marginPct: r.marginPct,
                status: r.status,
              },
            ]
          : [];
      }),
    };
  } catch (e) {
    if (e instanceof UserError) return null;
    throw e;
  }
}
