import {
  addDays,
  costPerBag,
  costPerKg,
  laborCostPerRun,
  roundMoney,
  roundQty,
  roundTo,
  STARCH_KG_PER_RECIPE,
  type CostLine,
  type IsoDate,
} from "@chipa/domain";
import { and, asc, desc, eq, gte, inArray, lte, ne, schema, sql, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import { todayAR } from "@/lib/dates";

/**
 * Costeo base (Regla 8). Lo usan la pantalla de precios (M6) y el tablero/costeo (M8).
 *
 *  - Ingredientes: receta activa × último precio de compra SIN IVA (`v_ingredient_last_price`).
 *  - Rendimiento: kg pesados ÷ kg de fécula de las producciones de los últimos 60 días; si no hay,
 *    el esperado de la receta. Nunca la suma de ingredientes (error 1 del Excel).
 *  - Mano de obra por kg = costo de una producción ÷ kg producidos por receta (75 kg de fécula × rendimiento).
 *  - Costo por unidad = costo/kg × peso neto + componentes (envase, jamón, queso feteado…).
 *  - Si falta el precio de un insumo o componente NO se asume $0 (error 8 del Excel): se marca
 *    "precio faltante" y el costo de ese producto queda en `null`.
 */

export const YIELD_WINDOW_DAYS = 60;

export interface IngredientCostLine {
  ingredientId: string;
  name: string;
  unit: "kg" | "l" | "unit";
  qtyPerKgStarch: number;
  /** Último precio sin IVA; null = no hay precio cargado ("precio faltante"). */
  unitPriceNet: number | null;
  /** Costo de este insumo en una producción de 75 kg de fécula. */
  costPerRun: number | null;
  /** Costo de este insumo por kg de producto terminado. */
  costPerKgProduct: number | null;
  /** % sobre el costo de ingredientes (como en la tabla del relevamiento). */
  pctOfIngredients: number | null;
  /** % sobre el costo directo por kg (ingredientes + mano de obra). */
  pctOfCost: number | null;
}

export interface ComponentCostLine {
  ingredientId: string;
  name: string;
  qtyPerUnit: number;
  unit: "kg" | "l" | "unit";
  unitPriceNet: number | null;
  cost: number | null;
}

export interface ProductCost {
  productId: string;
  code: string;
  name: string;
  presentation: string;
  netWeightKg: number;
  /** Masa: costo por kg × peso neto (null si el costo por kg está incompleto). */
  doughCost: number | null;
  /** Suma de componentes con precio conocido. */
  componentsCost: number;
  components: ComponentCostLine[];
  /** Costo directo por unidad de venta; null si falta algún precio. */
  unitCost: number | null;
  /** Nombres de los insumos sin precio ("precio faltante"). */
  missingPrices: string[];
}

export interface ProductCosts {
  recipe: { id: string; name: string; version: number };
  yield: {
    perKgStarch: number;
    source: "real" | "recipe";
    runs: number;
    weighedKg: number;
    starchKg: number;
    windowDays: number;
  };
  starchKgPerRun: number;
  producedKgPerRun: number;
  labor: { workers: number; hoursPerRun: number; hourlyCost: number; costPerRun: number; perKg: number };
  ingredients: IngredientCostLine[];
  /** Costo de ingredientes por kg de producto (null si falta algún precio de la receta). */
  ingredientsCostPerKg: number | null;
  /** Costo directo por kg (ingredientes + mano de obra); null si falta algún precio de la receta. */
  costPerKg: number | null;
  /** Insumos de la receta sin precio. */
  missingPrices: string[];
  products: ProductCost[];
  byProductId: Record<string, ProductCost>;
}

async function readLaborSettings(db: Executor) {
  const rows = await db
    .select()
    .from(schema.appSettings)
    .where(inArray(schema.appSettings.key, ["labor.workers", "labor.hours_per_run", "labor.hourly_cost"]));
  const m = Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
  return {
    workers: m["labor.workers"] ?? 4,
    hoursPerRun: m["labor.hours_per_run"] ?? 6,
    hourlyCost: m["labor.hourly_cost"] ?? 5000,
  };
}

/** Receta activa más reciente con sus ítems e insumos. */
async function activeRecipe(db: Executor) {
  const recipe = await db.query.recipes.findFirst({
    where: eq(schema.recipes.status, "active"),
    orderBy: [desc(schema.recipes.version), desc(schema.recipes.createdAt)],
    with: { items: { with: { ingredient: true } } },
  });
  if (!recipe) throw new UserError("No hay una receta activa: no se puede calcular el costo.");
  recipe.items.sort((a, b) => a.sortOrder - b.sortOrder);
  return recipe;
}

/** Rendimiento real: kg pesados ÷ kg de fécula de las producciones de los últimos 60 días. */
export async function realYield(db: Executor, today: IsoDate = todayAR()) {
  const r = schema.productionRuns;
  const w = schema.productionWeighings;
  const rows = await db
    .select({
      runId: r.id,
      starchKg: r.starchKg,
      weighedKg: sql<number>`sum(${w.kg})::float8`,
    })
    .from(r)
    .innerJoin(w, eq(w.runId, r.id))
    .where(and(gte(r.date, addDays(today, -YIELD_WINDOW_DAYS)), lte(r.date, today), ne(r.status, "cancelled")))
    .groupBy(r.id, r.starchKg);
  const valid = rows.filter((x) => Number(x.weighedKg) > 0 && x.starchKg > 0);
  const weighedKg = valid.reduce((a, x) => a + Number(x.weighedKg), 0);
  const starchKg = valid.reduce((a, x) => a + x.starchKg, 0);
  return { runs: valid.length, weighedKg: roundQty(weighedKg), starchKg: roundQty(starchKg) };
}

/** Último precio de compra sin IVA por insumo. */
async function lastPrices(db: Executor): Promise<Map<string, number>> {
  const rows = await db.select().from(schema.ingredientLastPrice);
  return new Map(rows.map((x) => [x.ingredientId, x.unitPriceNet]));
}

/** Costo directo por kg y por unidad de cada producto activo (Regla 8). */
export async function getProductCosts(db: Executor, today: IsoDate = todayAR()): Promise<ProductCosts> {
  const [recipe, labor, real, prices, products] = await Promise.all([
    activeRecipe(db),
    readLaborSettings(db),
    realYield(db, today),
    lastPrices(db),
    db.query.products.findMany({
      where: eq(schema.products.active, true),
      orderBy: asc(schema.products.code),
      with: { components: { with: { ingredient: true } } },
    }),
  ]);

  const useReal = real.runs > 0 && real.starchKg > 0;
  const yieldPerKgStarch = useReal ? real.weighedKg / real.starchKg : recipe.expectedYieldPerKgStarch;
  if (!(yieldPerKgStarch > 0)) throw new UserError("El rendimiento de la receta activa debe ser mayor a 0.");

  const starchKgPerRun = STARCH_KG_PER_RECIPE;
  const producedKgPerRun = roundQty(starchKgPerRun * yieldPerKgStarch);
  const laborPerRun = laborCostPerRun({
    workers: labor.workers,
    hours: labor.hoursPerRun,
    hourlyCost: labor.hourlyCost,
  });
  const laborPerKg = roundMoney(laborPerRun / producedKgPerRun);

  const priced: CostLine[] = [];
  const missing: string[] = [];
  for (const it of recipe.items) {
    const price = prices.get(it.ingredientId);
    if (price == null) missing.push(it.ingredient.name);
    else
      priced.push({ ingredientId: it.ingredientId, qty: it.qtyPerKgStarch * starchKgPerRun, unitPriceNet: price });
  }
  const complete = missing.length === 0;
  const perKg = complete
    ? costPerKg({ lines: priced, producedKg: producedKgPerRun, laborCost: laborPerRun })
    : null;
  const totalRun = priced.reduce((a, l) => a + l.qty * l.unitPriceNet, 0);
  const ingredientsPerKg = complete ? roundMoney(totalRun / producedKgPerRun) : null;

  const ingredientLines: IngredientCostLine[] = recipe.items.map((it) => {
    const price = prices.get(it.ingredientId) ?? null;
    const run = price == null ? null : roundMoney(it.qtyPerKgStarch * starchKgPerRun * price);
    const perKgProduct = run == null ? null : roundMoney(run / producedKgPerRun);
    return {
      ingredientId: it.ingredientId,
      name: it.ingredient.name,
      unit: it.ingredient.unit,
      qtyPerKgStarch: it.qtyPerKgStarch,
      unitPriceNet: price,
      costPerRun: run,
      costPerKgProduct: perKgProduct,
      pctOfIngredients: run == null || !complete ? null : roundTo((run / totalRun) * 100, 1),
      pctOfCost: perKgProduct == null || perKg == null ? null : roundTo((perKgProduct / perKg) * 100, 1),
    };
  });

  const productCosts: ProductCost[] = products.map((p) => {
    const components: ComponentCostLine[] = p.components.map((c) => {
      const price = prices.get(c.ingredientId) ?? null;
      return {
        ingredientId: c.ingredientId,
        name: c.ingredient.name,
        qtyPerUnit: c.qtyPerUnit,
        unit: c.ingredient.unit,
        unitPriceNet: price,
        cost: price == null ? null : roundMoney(c.qtyPerUnit * price),
      };
    });
    const componentsCost = roundMoney(components.reduce((a, c) => a + (c.cost ?? 0), 0));
    const missingPrices = [...missing, ...components.filter((c) => c.cost == null).map((c) => c.name)];
    const doughCost = perKg == null ? null : roundMoney(perKg * p.netWeightKg);
    const unitCost =
      perKg == null || missingPrices.length > 0
        ? null
        : costPerBag({ costPerKg: perKg, bagKg: p.netWeightKg, packagingCostPerBag: componentsCost });
    return {
      productId: p.id,
      code: p.code,
      name: p.name,
      presentation: p.presentation,
      netWeightKg: p.netWeightKg,
      doughCost,
      componentsCost,
      components,
      unitCost,
      missingPrices,
    };
  });

  return {
    recipe: { id: recipe.id, name: recipe.name, version: recipe.version },
    yield: {
      perKgStarch: roundTo(yieldPerKgStarch, 4),
      source: useReal ? "real" : "recipe",
      runs: real.runs,
      weighedKg: real.weighedKg,
      starchKg: real.starchKg,
      windowDays: YIELD_WINDOW_DAYS,
    },
    starchKgPerRun,
    producedKgPerRun,
    labor: { ...labor, costPerRun: laborPerRun, perKg: laborPerKg },
    ingredients: ingredientLines,
    ingredientsCostPerKg: ingredientsPerKg,
    costPerKg: perKg,
    missingPrices: missing,
    products: productCosts,
    byProductId: Object.fromEntries(productCosts.map((p) => [p.productId, p])),
  };
}
