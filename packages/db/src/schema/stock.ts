import { relations } from "drizzle-orm";
import { check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { day, id, qty, timestamps, tstz, pct } from "./_columns";
import { documentStatusEnum, stockItemKindEnum, stockMovementTypeEnum } from "./enums";
import { users } from "./auth";
import { ingredients, locations, products, suppliers } from "./catalog";
import { finishedLots } from "./production";
import { purchaseOrders } from "./purchases";

/** Recepción de mercadería (RF-11). */
export const receptions = pgTable("receptions", {
  id: id(),
  supplierId: uuid()
    .notNull()
    .references(() => suppliers.id),
  /** Orden de compra que se recibe (opcional). */
  purchaseOrderId: uuid().references(() => purchaseOrders.id),
  receivedAt: tstz().notNull().defaultNow(),
  receivedById: uuid().references(() => users.id),
  deliveryNote: text(),
  notes: text(),
  ...timestamps(),
});

/** Lote de materia prima: lo que entra de un proveedor con su lote y vencimiento. */
export const rawLots = pgTable(
  "raw_lots",
  {
    id: id(),
    ingredientId: uuid()
      .notNull()
      .references(() => ingredients.id),
    supplierId: uuid().references(() => suppliers.id),
    receptionId: uuid().references(() => receptions.id),
    supplierLotCode: text(),
    expiryDate: day(),
    receivedQty: qty().notNull(),
    /** Temperatura al recibir (refrigerados). */
    temperatureC: pct(),
    locationId: uuid().references(() => locations.id),
    ...timestamps(),
  },
  (t) => [index("raw_lots_ingredient_idx").on(t.ingredientId), index("raw_lots_expiry_idx").on(t.expiryDate)],
);

/**
 * Libro mayor de stock. Todo lo que mueve stock inserta una fila (signo + entra / − sale).
 * Stock = SUM(qty) agrupado por ítem/lote/ubicación (Regla RF-13).
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    occurredAt: tstz().notNull().defaultNow(),
    type: stockMovementTypeEnum().notNull(),
    itemKind: stockItemKindEnum().notNull(),
    ingredientId: uuid().references(() => ingredients.id),
    productId: uuid().references(() => products.id),
    rawLotId: uuid().references(() => rawLots.id),
    finishedLotId: uuid().references(() => finishedLots.id),
    locationId: uuid()
      .notNull()
      .references(() => locations.id),
    qty: qty().notNull(),
    /** Documento que originó el movimiento (tabla + id). */
    refTable: text(),
    refId: uuid(),
    note: text(),
    createdById: uuid().references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    index("stock_mov_ingredient_idx").on(t.ingredientId, t.occurredAt),
    index("stock_mov_product_idx").on(t.productId, t.occurredAt),
    index("stock_mov_finished_lot_idx").on(t.finishedLotId),
    index("stock_mov_raw_lot_idx").on(t.rawLotId),
    index("stock_mov_ref_idx").on(t.refTable, t.refId),
    check(
      "stock_mov_item_ck",
      sql`(item_kind = 'ingredient' AND ingredient_id IS NOT NULL AND product_id IS NULL) OR (item_kind = 'product' AND product_id IS NOT NULL AND ingredient_id IS NULL)`,
    ),
  ],
);

/** Inventario físico guiado (RF-15). */
export const inventoryCounts = pgTable("inventory_counts", {
  id: id(),
  date: day().notNull(),
  itemKind: stockItemKindEnum().notNull(),
  status: documentStatusEnum().notNull().default("draft"),
  countedById: uuid().references(() => users.id),
  notes: text(),
  ...timestamps(),
});

export const inventoryCountItems = pgTable(
  "inventory_count_items",
  {
    id: id(),
    countId: uuid()
      .notNull()
      .references(() => inventoryCounts.id, { onDelete: "cascade" }),
    ingredientId: uuid().references(() => ingredients.id),
    productId: uuid().references(() => products.id),
    /** Lote de la posición contada (insumo → lote de MP; producto → lote terminado). Null = sin lote. */
    rawLotId: uuid().references(() => rawLots.id),
    finishedLotId: uuid().references(() => finishedLots.id),
    locationId: uuid()
      .notNull()
      .references(() => locations.id),
    systemQty: qty().notNull(),
    countedQty: qty(),
    ...timestamps(),
  },
  (t) => [index("inventory_count_items_count_idx").on(t.countId)],
);

export const receptionsRelations = relations(receptions, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [receptions.supplierId], references: [suppliers.id] }),
  receivedBy: one(users, { fields: [receptions.receivedById], references: [users.id] }),
  purchaseOrder: one(purchaseOrders, {
    fields: [receptions.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  lots: many(rawLots),
}));
export const rawLotsRelations = relations(rawLots, ({ one, many }) => ({
  ingredient: one(ingredients, { fields: [rawLots.ingredientId], references: [ingredients.id] }),
  supplier: one(suppliers, { fields: [rawLots.supplierId], references: [suppliers.id] }),
  reception: one(receptions, { fields: [rawLots.receptionId], references: [receptions.id] }),
  location: one(locations, { fields: [rawLots.locationId], references: [locations.id] }),
  movements: many(stockMovements),
}));
export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  ingredient: one(ingredients, { fields: [stockMovements.ingredientId], references: [ingredients.id] }),
  product: one(products, { fields: [stockMovements.productId], references: [products.id] }),
  rawLot: one(rawLots, { fields: [stockMovements.rawLotId], references: [rawLots.id] }),
  finishedLot: one(finishedLots, { fields: [stockMovements.finishedLotId], references: [finishedLots.id] }),
  location: one(locations, { fields: [stockMovements.locationId], references: [locations.id] }),
  createdBy: one(users, { fields: [stockMovements.createdById], references: [users.id] }),
}));
export const inventoryCountsRelations = relations(inventoryCounts, ({ many, one }) => ({
  items: many(inventoryCountItems),
  countedBy: one(users, { fields: [inventoryCounts.countedById], references: [users.id] }),
}));
export const inventoryCountItemsRelations = relations(inventoryCountItems, ({ one }) => ({
  count: one(inventoryCounts, { fields: [inventoryCountItems.countId], references: [inventoryCounts.id] }),
  ingredient: one(ingredients, { fields: [inventoryCountItems.ingredientId], references: [ingredients.id] }),
  product: one(products, { fields: [inventoryCountItems.productId], references: [products.id] }),
  location: one(locations, { fields: [inventoryCountItems.locationId], references: [locations.id] }),
}));
