import { sql } from "drizzle-orm";
import { date, numeric, pgView, uuid } from "drizzle-orm/pg-core";

/** Saldo de insumos por lote y ubicación (RF-13). */
export const ingredientStock = pgView("v_ingredient_stock", {
  ingredientId: uuid("ingredient_id").notNull(),
  rawLotId: uuid("raw_lot_id"),
  locationId: uuid("location_id").notNull(),
  qty: numeric("qty", { mode: "number" }).notNull(),
}).as(sql`
  SELECT ingredient_id, raw_lot_id, location_id, SUM(qty) AS qty
  FROM stock_movements
  WHERE item_kind = 'ingredient'
  GROUP BY ingredient_id, raw_lot_id, location_id
  HAVING SUM(qty) <> 0
`);

/** Saldo de producto terminado por lote y ubicación (RF-16). */
export const productStock = pgView("v_product_stock", {
  productId: uuid("product_id").notNull(),
  finishedLotId: uuid("finished_lot_id"),
  locationId: uuid("location_id").notNull(),
  qty: numeric("qty", { mode: "number" }).notNull(),
}).as(sql`
  SELECT product_id, finished_lot_id, location_id, SUM(qty) AS qty
  FROM stock_movements
  WHERE item_kind = 'product'
  GROUP BY product_id, finished_lot_id, location_id
  HAVING SUM(qty) <> 0
`);

/** Último precio de compra sin IVA por insumo (Regla 8). */
export const ingredientLastPrice = pgView("v_ingredient_last_price", {
  ingredientId: uuid("ingredient_id").notNull(),
  supplierId: uuid("supplier_id"),
  date: date("date", { mode: "string" }).notNull(),
  unitPriceNet: numeric("unit_price_net", { mode: "number" }).notNull(),
}).as(sql`
  SELECT DISTINCT ON (ingredient_id) ingredient_id, supplier_id, date, unit_price_net
  FROM ingredient_prices
  ORDER BY ingredient_id, date DESC, created_at DESC
`);

/** Último costo de compra sin IVA por producto de reventa. */
export const productLastCost = pgView("v_product_last_cost", {
  productId: uuid("product_id").notNull(),
  supplierId: uuid("supplier_id"),
  date: date("date", { mode: "string" }).notNull(),
  unitCostNet: numeric("unit_cost_net", { mode: "number" }).notNull(),
}).as(sql`
  SELECT DISTINCT ON (product_id) product_id, supplier_id, date, unit_cost_net
  FROM product_costs
  ORDER BY product_id, date DESC, created_at DESC
`);
