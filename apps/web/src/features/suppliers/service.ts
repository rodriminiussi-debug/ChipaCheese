import { and, asc, eq, ilike, ne, or, schema, sql, type Executor } from "@chipa/db";
import { priceVariationPct } from "@chipa/domain";
import { UserError } from "@/server/errors";
import type { SupplierData } from "./schemas";

/** Servicio de proveedores (RF-07). Mismo patrón que `features/customers`. */
export async function listSuppliers(db: Executor, f: { q?: string; includeInactive?: boolean } = {}) {
  const s = schema.suppliers;
  const where = and(
    f.includeInactive ? undefined : eq(s.active, true),
    f.q
      ? or(
          ilike(s.legalName, `%${f.q}%`),
          ilike(s.tradeName, `%${f.q}%`),
          ilike(s.cuit, `%${f.q.replace(/\D/g, "") || f.q}%`),
        )
      : undefined,
  );
  return db.query.suppliers.findMany({ where, orderBy: asc(s.legalName) });
}

export function getSupplier(db: Executor, id: string) {
  return db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, id) });
}

async function assertUniqueCuit(db: Executor, cuit: string | null, exceptId?: string) {
  if (!cuit) return;
  const dup = await db.query.suppliers.findFirst({
    where: and(eq(schema.suppliers.cuit, cuit), exceptId ? ne(schema.suppliers.id, exceptId) : undefined),
  });
  if (dup)
    throw new UserError(`Ya existe un proveedor con ese CUIT (${dup.legalName}).`, {
      cuit: ["CUIT duplicado"],
    });
}

export async function createSupplier(db: Executor, input: SupplierData) {
  await assertUniqueCuit(db, input.cuit);
  const [row] = await db.insert(schema.suppliers).values(input).returning();
  return row!;
}

export async function updateSupplier(db: Executor, id: string, input: SupplierData) {
  await assertUniqueCuit(db, input.cuit, id);
  const [row] = await db.update(schema.suppliers).set(input).where(eq(schema.suppliers.id, id)).returning();
  if (!row) throw new UserError("El proveedor no existe.");
  return row;
}

/**
 * Insumos del catálogo con la marca de si los vende este proveedor, su código y el último
 * precio neto que nos cobró (con variación contra la compra anterior).
 */
export async function supplierIngredientRows(db: Executor, supplierId: string) {
  const [ingredients, sold, prices] = await Promise.all([
    db.query.ingredients.findMany({
      where: eq(schema.ingredients.active, true),
      orderBy: asc(schema.ingredients.name),
    }),
    db.query.supplierIngredients.findMany({ where: eq(schema.supplierIngredients.supplierId, supplierId) }),
    db
      .select({
        ingredientId: schema.ingredientPrices.ingredientId,
        date: schema.ingredientPrices.date,
        unitPriceNet: schema.ingredientPrices.unitPriceNet,
      })
      .from(schema.ingredientPrices)
      .where(eq(schema.ingredientPrices.supplierId, supplierId))
      .orderBy(
        asc(schema.ingredientPrices.ingredientId),
        sql`${schema.ingredientPrices.date} desc`,
        sql`${schema.ingredientPrices.createdAt} desc`,
      ),
  ]);
  const soldBy = new Map(sold.map((x) => [x.ingredientId, x]));
  const byIngredient = new Map<string, typeof prices>();
  for (const p of prices) byIngredient.set(p.ingredientId, [...(byIngredient.get(p.ingredientId) ?? []), p]);
  return ingredients.map((i) => {
    const [last, previous] = byIngredient.get(i.id) ?? [];
    return {
      ingredientId: i.id,
      name: i.name,
      unit: i.unit,
      sold: soldBy.has(i.id),
      supplierCode: soldBy.get(i.id)?.supplierCode ?? null,
      lastPrice: last?.unitPriceNet ?? null,
      lastPriceDate: last?.date ?? null,
      variationPct: last && previous ? priceVariationPct(previous.unitPriceNet, last.unitPriceNet) : null,
    };
  });
}
export type SupplierIngredientRow = Awaited<ReturnType<typeof supplierIngredientRows>>[number];

/** Reemplaza el conjunto de insumos que vende el proveedor. */
export async function setSupplierIngredients(
  db: Executor,
  supplierId: string,
  items: { ingredientId: string; supplierCode: string | null }[],
) {
  const supplier = await getSupplier(db, supplierId);
  if (!supplier) throw new UserError("El proveedor no existe.");
  await db.delete(schema.supplierIngredients).where(eq(schema.supplierIngredients.supplierId, supplierId));
  if (items.length)
    await db.insert(schema.supplierIngredients).values(items.map((i) => ({ supplierId, ...i })));
  return items.length;
}
