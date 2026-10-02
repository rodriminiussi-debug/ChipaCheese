import { relations } from "drizzle-orm";
import { boolean, index, integer, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { day, id, qty, timestamps, tstz } from "./_columns";
import { planStatusEnum, productShapeEnum, productionStatusEnum, recipeStatusEnum, shiftEnum } from "./enums";
import { users } from "./auth";
import { ingredients, locations, products } from "./catalog";
import { rawLots } from "./stock";

/** Receta maestra versionada, expresada por kg de fécula (RF-18). */
export const recipes = pgTable(
  "recipes",
  {
    id: id(),
    name: text().notNull(),
    version: integer().notNull(),
    status: recipeStatusEnum().notNull().default("draft"),
    /** kg de producto pesado esperados por kg de fécula (≈ 2: 75 kg fécula → 150 kg). */
    expectedYieldPerKgStarch: qty().notNull(),
    /** Umbral de desvío consumo real vs teórico, en % (Regla 2). */
    deviationThresholdPct: qty().notNull().default(10),
    effectiveFrom: day(),
    notes: text(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("recipes_name_version_uq").on(t.name, t.version)],
);

export const recipeItems = pgTable(
  "recipe_items",
  {
    id: id(),
    recipeId: uuid()
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    ingredientId: uuid()
      .notNull()
      .references(() => ingredients.id),
    qtyPerKgStarch: qty().notNull(),
    /** Rango aceptable (p. ej. leche 0,24–0,40 L por kg de fécula). */
    minPerKgStarch: qty(),
    maxPerKgStarch: qty(),
    /** Quién dosifica / cómo (texto para la ficha imprimible). */
    instructions: text(),
    sortOrder: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex("recipe_items_uq").on(t.recipeId, t.ingredientId)],
);

/** Plan de producción diario (RF-19). */
export const productionPlans = pgTable("production_plans", {
  id: id(),
  date: day().notNull().unique(),
  status: planStatusEnum().notNull().default("draft"),
  totalKg: qty().notNull().default(0),
  notes: text(),
  ...timestamps(),
});

export const productionPlanItems = pgTable(
  "production_plan_items",
  {
    id: id(),
    planId: uuid()
      .notNull()
      .references(() => productionPlans.id, { onDelete: "cascade" }),
    shape: productShapeEnum().notNull(),
    kg: qty().notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("production_plan_items_uq").on(t.planId, t.shape)],
);

/** Una producción = una receta elaborada en el día (registro de elaboración, RF-20). */
export const productionRuns = pgTable(
  "production_runs",
  {
    id: id(),
    date: day().notNull(),
    /** Número de producción del día (para el código de lote AAMMDD-N). */
    runNumber: integer().notNull(),
    shift: shiftEnum().notNull().default("morning"),
    recipeId: uuid()
      .notNull()
      .references(() => recipes.id),
    planId: uuid().references(() => productionPlans.id),
    starchKg: qty().notNull(),
    batches: integer().notNull().default(2),
    status: productionStatusEnum().notNull().default("planned"),
    responsibleId: uuid().references(() => users.id),
    supervisorId: uuid().references(() => users.id),
    /** Abatidor usado (F1/F2) y hora de entrada al congelado. */
    freezerCodes: text().array().notNull().default([]),
    frozenAt: tstz(),
    lateEntry: boolean().notNull().default(false),
    notes: text(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("production_runs_day_number_uq").on(t.date, t.runNumber),
    index("production_runs_date_idx").on(t.date),
  ],
);

/** Operarios que participaron de la producción. */
export const productionRunWorkers = pgTable(
  "production_run_workers",
  {
    runId: uuid()
      .notNull()
      .references(() => productionRuns.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.userId] })],
);

/** Consumo real vs teórico por insumo y lote de materia prima. */
export const productionConsumptions = pgTable(
  "production_consumptions",
  {
    id: id(),
    runId: uuid()
      .notNull()
      .references(() => productionRuns.id, { onDelete: "cascade" }),
    ingredientId: uuid()
      .notNull()
      .references(() => ingredients.id),
    rawLotId: uuid().references(() => rawLots.id),
    qtyTheoretical: qty().notNull(),
    qtyActual: qty().notNull(),
    outOfRange: boolean().notNull().default(false),
    notes: text(),
    ...timestamps(),
  },
  (t) => [
    index("production_consumptions_run_idx").on(t.runId),
    index("production_consumptions_lot_idx").on(t.rawLotId),
  ],
);

/** Pesadas por forma (RF-21). */
export const productionWeighings = pgTable(
  "production_weighings",
  {
    id: id(),
    runId: uuid()
      .notNull()
      .references(() => productionRuns.id, { onDelete: "cascade" }),
    shape: productShapeEnum().notNull(),
    kg: qty().notNull(),
    weighedById: uuid().references(() => users.id),
    weighedAt: tstz().notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [index("production_weighings_run_idx").on(t.runId)],
);

/** Lote de producto terminado. Código único AAMMDD-N, vence a los 6 meses (Regla 4). */
export const finishedLots = pgTable(
  "finished_lots",
  {
    id: id(),
    code: text().notNull().unique(),
    runId: uuid()
      .notNull()
      .references(() => productionRuns.id),
    productionDate: day().notNull(),
    expiryDate: day().notNull(),
    /** Retenido por calidad (reclamo / retiro): no se despacha. */
    onHold: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [index("finished_lots_run_idx").on(t.runId), index("finished_lots_expiry_idx").on(t.expiryDate)],
);

/** Envasado: bolsas por producto dentro del lote (RF-22). Genera movimiento de stock. */
export const packings = pgTable(
  "packings",
  {
    id: id(),
    finishedLotId: uuid()
      .notNull()
      .references(() => finishedLots.id),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    units: integer().notNull(),
    kg: qty().notNull(),
    locationId: uuid()
      .notNull()
      .references(() => locations.id),
    packedById: uuid().references(() => users.id),
    packedAt: tstz().notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [index("packings_lot_idx").on(t.finishedLotId)],
);

export const recipesRelations = relations(recipes, ({ many }) => ({
  items: many(recipeItems),
  runs: many(productionRuns),
}));
export const recipeItemsRelations = relations(recipeItems, ({ one }) => ({
  recipe: one(recipes, { fields: [recipeItems.recipeId], references: [recipes.id] }),
  ingredient: one(ingredients, { fields: [recipeItems.ingredientId], references: [ingredients.id] }),
}));
export const productionPlansRelations = relations(productionPlans, ({ many }) => ({
  items: many(productionPlanItems),
  runs: many(productionRuns),
}));
export const productionPlanItemsRelations = relations(productionPlanItems, ({ one }) => ({
  plan: one(productionPlans, { fields: [productionPlanItems.planId], references: [productionPlans.id] }),
}));
export const productionRunsRelations = relations(productionRuns, ({ one, many }) => ({
  recipe: one(recipes, { fields: [productionRuns.recipeId], references: [recipes.id] }),
  plan: one(productionPlans, { fields: [productionRuns.planId], references: [productionPlans.id] }),
  responsible: one(users, {
    fields: [productionRuns.responsibleId],
    references: [users.id],
    relationName: "run_responsible",
  }),
  supervisor: one(users, {
    fields: [productionRuns.supervisorId],
    references: [users.id],
    relationName: "run_supervisor",
  }),
  workers: many(productionRunWorkers),
  consumptions: many(productionConsumptions),
  weighings: many(productionWeighings),
  lots: many(finishedLots),
}));
export const productionRunWorkersRelations = relations(productionRunWorkers, ({ one }) => ({
  run: one(productionRuns, { fields: [productionRunWorkers.runId], references: [productionRuns.id] }),
  user: one(users, { fields: [productionRunWorkers.userId], references: [users.id] }),
}));
export const productionConsumptionsRelations = relations(productionConsumptions, ({ one }) => ({
  run: one(productionRuns, { fields: [productionConsumptions.runId], references: [productionRuns.id] }),
  ingredient: one(ingredients, {
    fields: [productionConsumptions.ingredientId],
    references: [ingredients.id],
  }),
  rawLot: one(rawLots, { fields: [productionConsumptions.rawLotId], references: [rawLots.id] }),
}));
export const productionWeighingsRelations = relations(productionWeighings, ({ one }) => ({
  run: one(productionRuns, { fields: [productionWeighings.runId], references: [productionRuns.id] }),
}));
export const finishedLotsRelations = relations(finishedLots, ({ one, many }) => ({
  run: one(productionRuns, { fields: [finishedLots.runId], references: [productionRuns.id] }),
  packings: many(packings),
}));
export const packingsRelations = relations(packings, ({ one }) => ({
  lot: one(finishedLots, { fields: [packings.finishedLotId], references: [finishedLots.id] }),
  product: one(products, { fields: [packings.productId], references: [products.id] }),
  location: one(locations, { fields: [packings.locationId], references: [locations.id] }),
}));
