import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { day, id, money, pct, qty, timestamps } from "./_columns";
import {
  channelEnum,
  equipmentKindEnum,
  ingredientCategoryEnum,
  locationKindEnum,
  presentationEnum,
  productShapeEnum,
  unitEnum,
} from "./enums";

/** Parámetros del negocio editables (capacidad, costo hora, umbrales…). Clave → JSON. */
export const appSettings = pgTable("app_settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  description: text(),
  ...timestamps(),
});

/** Zonas de reparto con sus días fijos (1=lunes … 7=domingo). */
export const zones = pgTable("zones", {
  id: id(),
  name: text().notNull().unique(),
  deliveryWeekdays: integer().array().notNull().default([]),
  ...timestamps(),
});

export const priceLists = pgTable("price_lists", {
  id: id(),
  name: text().notNull().unique(),
  channel: channelEnum().notNull(),
  /** Margen objetivo del canal en % (Regla 9). */
  targetMarginPct: pct().notNull().default(0),
  active: boolean().notNull().default(true),
  ...timestamps(),
});

export const customers = pgTable(
  "customers",
  {
    id: id(),
    legalName: text().notNull(),
    tradeName: text(),
    cuit: text(),
    channel: channelEnum().notNull(),
    priceListId: uuid().references(() => priceLists.id),
    zoneId: uuid().references(() => zones.id),
    /** Días de entrega preferidos 1..7; si está vacío se usan los de la zona. */
    deliveryWeekdays: integer().array().notNull().default([]),
    /** Plazo de pago en días (0 = contado). */
    paymentTermsDays: integer().notNull().default(0),
    paymentNotes: text(),
    whatsapp: text(),
    address: text(),
    notes: text(),
    active: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("customers_cuit_uq").on(t.cuit), index("customers_zone_idx").on(t.zoneId)],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    legalName: text().notNull(),
    tradeName: text(),
    cuit: text(),
    leadTimeDays: integer().notNull().default(1),
    paymentTermsDays: integer().notNull().default(0),
    paymentNotes: text(),
    whatsapp: text(),
    notes: text(),
    active: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("suppliers_cuit_uq").on(t.cuit)],
);

/** Insumos: materias primas y envases. */
export const ingredients = pgTable("ingredients", {
  id: id(),
  name: text().notNull().unique(),
  category: ingredientCategoryEnum().notNull(),
  unit: unitEnum().notNull(),
  refrigerated: boolean().notNull().default(false),
  minStock: qty().notNull().default(0),
  safetyStock: qty().notNull().default(0),
  defaultSupplierId: uuid().references(() => suppliers.id),
  active: boolean().notNull().default(true),
  ...timestamps(),
});

/** Qué proveedor vende qué insumo. */
export const supplierIngredients = pgTable(
  "supplier_ingredients",
  {
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    ingredientId: uuid()
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    supplierCode: text(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.supplierId, t.ingredientId] })],
);

/** Productos terminados (SKU). */
export const products = pgTable("products", {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  shape: productShapeEnum().notNull(),
  presentation: presentationEnum().notNull(),
  /** Peso neto de masa por unidad de venta, en kg (bolsa 0,5 / granel 5 / sándwich 0,18). */
  netWeightKg: qty().notNull(),
  /** Código usado en el pizarrón (SW, C500, SWG, C granel). */
  boardCode: text(),
  minStockUnits: integer().notNull().default(0),
  active: boolean().notNull().default(true),
  ...timestamps(),
});

/** Componentes por unidad además de la masa: envase, etiqueta, jamón y queso del sándwich… */
export const productComponents = pgTable(
  "product_components",
  {
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    ingredientId: uuid()
      .notNull()
      .references(() => ingredients.id),
    qtyPerUnit: qty().notNull(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.ingredientId] })],
);

export const priceListItems = pgTable(
  "price_list_items",
  {
    id: id(),
    priceListId: uuid()
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    unitPrice: money().notNull(),
    validFrom: day().notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("price_list_items_uq").on(t.priceListId, t.productId, t.validFrom)],
);

/** Depósitos / ubicaciones de stock: heladera, depósito seco, F3, F4, local, vehículo. */
export const locations = pgTable("locations", {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  kind: locationKindEnum().notNull(),
  capacityKg: qty(),
  active: boolean().notNull().default(true),
  ...timestamps(),
});

/** Equipos de planta (también son puntos de control de temperatura y de mantenimiento). */
export const equipment = pgTable("equipment", {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  area: text().notNull(),
  kind: equipmentKindEnum().notNull(),
  /** Rango de temperatura aceptable (°C), si aplica. */
  tempMinC: numericTemp(),
  tempMaxC: numericTemp(),
  locationId: uuid().references(() => locations.id),
  active: boolean().notNull().default(true),
  ...timestamps(),
});

function numericTemp() {
  return pct();
}

export const vehicles = pgTable("vehicles", {
  id: id(),
  plate: text().notNull().unique(),
  name: text().notNull(),
  hasColdUnit: boolean().notNull().default(true),
  /** Costo por km estimado (combustible + desgaste) para costear rutas. */
  costPerKm: money().notNull().default(0),
  equipmentId: uuid().references(() => equipment.id),
  locationId: uuid().references(() => locations.id),
  active: boolean().notNull().default(true),
  ...timestamps(),
});

export const customersRelations = relations(customers, ({ one }) => ({
  priceList: one(priceLists, { fields: [customers.priceListId], references: [priceLists.id] }),
  zone: one(zones, { fields: [customers.zoneId], references: [zones.id] }),
}));
export const zonesRelations = relations(zones, ({ many }) => ({ customers: many(customers) }));
export const priceListsRelations = relations(priceLists, ({ many }) => ({
  items: many(priceListItems),
  customers: many(customers),
}));
export const priceListItemsRelations = relations(priceListItems, ({ one }) => ({
  priceList: one(priceLists, { fields: [priceListItems.priceListId], references: [priceLists.id] }),
  product: one(products, { fields: [priceListItems.productId], references: [products.id] }),
}));
export const suppliersRelations = relations(suppliers, ({ many }) => ({
  ingredients: many(supplierIngredients),
}));
export const ingredientsRelations = relations(ingredients, ({ one, many }) => ({
  defaultSupplier: one(suppliers, { fields: [ingredients.defaultSupplierId], references: [suppliers.id] }),
  suppliers: many(supplierIngredients),
}));
export const supplierIngredientsRelations = relations(supplierIngredients, ({ one }) => ({
  supplier: one(suppliers, { fields: [supplierIngredients.supplierId], references: [suppliers.id] }),
  ingredient: one(ingredients, { fields: [supplierIngredients.ingredientId], references: [ingredients.id] }),
}));
export const productsRelations = relations(products, ({ many }) => ({
  components: many(productComponents),
  prices: many(priceListItems),
}));
export const productComponentsRelations = relations(productComponents, ({ one }) => ({
  product: one(products, { fields: [productComponents.productId], references: [products.id] }),
  ingredient: one(ingredients, { fields: [productComponents.ingredientId], references: [ingredients.id] }),
}));
export const equipmentRelations = relations(equipment, ({ one }) => ({
  location: one(locations, { fields: [equipment.locationId], references: [locations.id] }),
}));
export const vehiclesRelations = relations(vehicles, ({ one }) => ({
  equipment: one(equipment, { fields: [vehicles.equipmentId], references: [equipment.id] }),
  location: one(locations, { fields: [vehicles.locationId], references: [locations.id] }),
}));
