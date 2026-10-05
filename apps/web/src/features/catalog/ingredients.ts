import type { IsoDate } from "@chipa/domain";
import { and, asc, eq, ilike, ne, schema, sql, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import { todayAR } from "@/lib/dates";
import type { IngredientData } from "./schemas";

/** Insumos: materias primas y envases. Se desactivan, no se borran (tienen historial de precios y stock). */

export interface IngredientListFilter {
  q?: string;
  category?: string;
  status?: "active" | "inactive" | "all";
}

export async function listIngredients(db: Executor, f: IngredientListFilter = {}) {
  const i = schema.ingredients;
  const q = f.q?.trim();
  const status = f.status ?? "active";
  const [rows, prices] = await Promise.all([
    db.query.ingredients.findMany({
      where: and(
        status === "all" ? undefined : eq(i.active, status === "active"),
        f.category ? eq(i.category, f.category as IngredientData["category"]) : undefined,
        q ? ilike(i.name, `%${q}%`) : undefined,
      ),
      orderBy: [asc(i.category), asc(i.name)],
      with: { defaultSupplier: true },
    }),
    db.select().from(schema.ingredientLastPrice),
  ]);
  const price = new Map(prices.map((p) => [p.ingredientId, p]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    unit: r.unit,
    refrigerated: r.refrigerated,
    minStock: r.minStock,
    safetyStock: r.safetyStock,
    active: r.active,
    defaultSupplierId: r.defaultSupplierId,
    supplierName: r.defaultSupplier?.tradeName ?? r.defaultSupplier?.legalName ?? null,
    lastPrice: price.get(r.id)?.unitPriceNet ?? null,
    lastPriceDate: price.get(r.id)?.date ?? null,
  }));
}
export type IngredientListRow = Awaited<ReturnType<typeof listIngredients>>[number];

export async function ingredientFormOptions(db: Executor) {
  const suppliers = await db.query.suppliers.findMany({
    where: eq(schema.suppliers.active, true),
    orderBy: asc(schema.suppliers.legalName),
  });
  return { suppliers: suppliers.map((s) => ({ id: s.id, name: s.tradeName ?? s.legalName })) };
}
export type IngredientFormOptions = Awaited<ReturnType<typeof ingredientFormOptions>>;

async function assertUniqueName(db: Executor, name: string, exceptId?: string) {
  const i = schema.ingredients;
  const dup = await db.query.ingredients.findFirst({
    where: and(sql`lower(${i.name}) = lower(${name})`, exceptId ? ne(i.id, exceptId) : undefined),
  });
  if (dup) throw new UserError(`Ya existe un insumo llamado "${dup.name}".`, { name: ["Nombre repetido"] });
}

async function assertSupplier(db: Executor, id: string | null) {
  if (!id) return;
  const s = await db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, id) });
  if (!s) throw new UserError("El proveedor no existe.", { defaultSupplierId: ["Proveedor inexistente"] });
}

export async function createIngredient(db: Executor, input: IngredientData, today: IsoDate = todayAR()) {
  await assertUniqueName(db, input.name);
  await assertSupplier(db, input.defaultSupplierId);
  const { initialPrice, ...cols } = input;
  const [row] = await db.insert(schema.ingredients).values(cols).returning();
  if (input.defaultSupplierId)
    await db
      .insert(schema.supplierIngredients)
      .values({ supplierId: input.defaultSupplierId, ingredientId: row!.id })
      .onConflictDoNothing();
  if (initialPrice != null)
    await db.insert(schema.ingredientPrices).values({
      ingredientId: row!.id,
      supplierId: input.defaultSupplierId,
      date: today,
      unitPriceNet: initialPrice,
    });
  return row!;
}

export async function updateIngredient(db: Executor, id: string, input: IngredientData) {
  const current = await db.query.ingredients.findFirst({ where: eq(schema.ingredients.id, id) });
  if (!current) throw new UserError("El insumo no existe.");
  await assertUniqueName(db, input.name, id);
  await assertSupplier(db, input.defaultSupplierId);
  if (current.unit !== input.unit) {
    const [prices, moves] = await Promise.all([
      db.query.ingredientPrices.findFirst({ where: eq(schema.ingredientPrices.ingredientId, id) }),
      db.query.stockMovements.findFirst({ where: eq(schema.stockMovements.ingredientId, id) }),
    ]);
    if (prices || moves)
      throw new UserError(
        "No se puede cambiar la unidad de un insumo con precios o movimientos de stock: los números históricos dejarían de coincidir.",
        { unit: ["Ya tiene historial en otra unidad"] },
      );
  }
  if (current.active && !input.active) await assertCanDeactivate(db, id, current.name);
  const { initialPrice: _ignored, ...cols } = input;
  void _ignored;
  const [row] = await db
    .update(schema.ingredients)
    .set(cols)
    .where(eq(schema.ingredients.id, id))
    .returning();
  if (input.defaultSupplierId)
    await db
      .insert(schema.supplierIngredients)
      .values({ supplierId: input.defaultSupplierId, ingredientId: id })
      .onConflictDoNothing();
  return row!;
}

async function assertCanDeactivate(db: Executor, id: string, name: string) {
  const inRecipe = await db
    .select({ id: schema.recipeItems.id })
    .from(schema.recipeItems)
    .innerJoin(schema.recipes, eq(schema.recipes.id, schema.recipeItems.recipeId))
    .where(and(eq(schema.recipeItems.ingredientId, id), eq(schema.recipes.status, "active")))
    .limit(1);
  if (inRecipe.length)
    throw new UserError(`"${name}" está en la receta maestra activa: no se puede desactivar.`);
}

export async function setIngredientActive(db: Executor, id: string, active: boolean) {
  const current = await db.query.ingredients.findFirst({ where: eq(schema.ingredients.id, id) });
  if (!current) throw new UserError("El insumo no existe.");
  if (current.active && !active) await assertCanDeactivate(db, id, current.name);
  const [row] = await db
    .update(schema.ingredients)
    .set({ active })
    .where(eq(schema.ingredients.id, id))
    .returning();
  return row!;
}
