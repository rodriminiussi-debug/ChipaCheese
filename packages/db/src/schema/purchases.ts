import { relations } from "drizzle-orm";
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { day, id, money, pct, qty, timestamps } from "./_columns";
import {
  documentSourceEnum,
  documentStatusEnum,
  invoiceTypeEnum,
  paymentMethodEnum,
  purchaseOrderStatusEnum,
  unitEnum,
} from "./enums";
import { users } from "./auth";
import { ingredients, suppliers } from "./catalog";

/** Orden de compra con fecha esperada y responsable (RF-10). */
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: id(),
    number: text().notNull().unique(),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id),
    orderedAt: day().notNull(),
    expectedAt: day(),
    status: purchaseOrderStatusEnum().notNull().default("draft"),
    responsibleId: uuid().references(() => users.id),
    notes: text(),
    ...timestamps(),
  },
  (t) => [
    index("purchase_orders_supplier_idx").on(t.supplierId),
    index("purchase_orders_expected_idx").on(t.expectedAt),
  ],
);

export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: id(),
  purchaseOrderId: uuid()
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: "cascade" }),
  ingredientId: uuid()
    .notNull()
    .references(() => ingredients.id),
  qty: qty().notNull(),
  unit: unitEnum().notNull(),
  estimatedUnitPrice: money(),
  ...timestamps(),
});

/** Factura de compra (cargada a mano o leída por IA desde una foto, RF-08). */
export const purchaseInvoices = pgTable(
  "purchase_invoices",
  {
    id: id(),
    supplierId: uuid().references(() => suppliers.id),
    purchaseOrderId: uuid().references(() => purchaseOrders.id),
    invoiceType: invoiceTypeEnum().notNull().default("A"),
    pointOfSale: text(),
    number: text(),
    issueDate: day(),
    dueDate: day(),
    netTotal: money().notNull().default(0),
    vatTotal: money().notNull().default(0),
    otherTaxes: money().notNull().default(0),
    total: money().notNull().default(0),
    status: documentStatusEnum().notNull().default("draft"),
    source: documentSourceEnum().notNull().default("manual"),
    /** Clave del archivo (foto/PDF) en el storage S3. */
    fileKey: text(),
    /** Respuesta cruda de la IA para auditoría. */
    aiExtraction: jsonb(),
    notes: text(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("purchase_invoices_number_uq").on(t.supplierId, t.invoiceType, t.pointOfSale, t.number),
    index("purchase_invoices_issue_idx").on(t.issueDate),
  ],
);

export const purchaseInvoiceItems = pgTable(
  "purchase_invoice_items",
  {
    id: id(),
    invoiceId: uuid()
      .notNull()
      .references(() => purchaseInvoices.id, { onDelete: "cascade" }),
    /** Null mientras el usuario no mapea la línea a un insumo. */
    ingredientId: uuid().references(() => ingredients.id),
    description: text().notNull(),
    qty: qty().notNull(),
    unit: unitEnum(),
    unitPriceNet: money().notNull(),
    vatRate: pct().notNull().default(21),
    vatAmount: money().notNull().default(0),
    lineTotal: money().notNull().default(0),
    ...timestamps(),
  },
  (t) => [index("purchase_invoice_items_invoice_idx").on(t.invoiceId)],
);

/** Historial de precios por insumo y proveedor (RF-09). Se escribe al confirmar una factura. */
export const ingredientPrices = pgTable(
  "ingredient_prices",
  {
    id: id(),
    ingredientId: uuid()
      .notNull()
      .references(() => ingredients.id),
    supplierId: uuid().references(() => suppliers.id),
    date: day().notNull(),
    /** Precio unitario SIN IVA en la unidad del insumo. */
    unitPriceNet: money().notNull(),
    invoiceItemId: uuid().references(() => purchaseInvoiceItems.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [index("ingredient_prices_lookup_idx").on(t.ingredientId, t.date)],
);

/** Pagos a proveedores (cuenta corriente, RF-12). */
export const supplierPayments = pgTable(
  "supplier_payments",
  {
    id: id(),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id),
    date: day().notNull(),
    amount: money().notNull(),
    method: paymentMethodEnum().notNull(),
    reference: text(),
    notes: text(),
    ...timestamps(),
  },
  (t) => [index("supplier_payments_supplier_idx").on(t.supplierId, t.date)],
);

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  responsible: one(users, { fields: [purchaseOrders.responsibleId], references: [users.id] }),
  items: many(purchaseOrderItems),
}));
export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderItems.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  ingredient: one(ingredients, { fields: [purchaseOrderItems.ingredientId], references: [ingredients.id] }),
}));
export const purchaseInvoicesRelations = relations(purchaseInvoices, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [purchaseInvoices.supplierId], references: [suppliers.id] }),
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseInvoices.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  items: many(purchaseInvoiceItems),
}));
export const purchaseInvoiceItemsRelations = relations(purchaseInvoiceItems, ({ one }) => ({
  invoice: one(purchaseInvoices, {
    fields: [purchaseInvoiceItems.invoiceId],
    references: [purchaseInvoices.id],
  }),
  ingredient: one(ingredients, { fields: [purchaseInvoiceItems.ingredientId], references: [ingredients.id] }),
}));
export const ingredientPricesRelations = relations(ingredientPrices, ({ one }) => ({
  ingredient: one(ingredients, { fields: [ingredientPrices.ingredientId], references: [ingredients.id] }),
  supplier: one(suppliers, { fields: [ingredientPrices.supplierId], references: [suppliers.id] }),
}));
export const supplierPaymentsRelations = relations(supplierPayments, ({ one }) => ({
  supplier: one(suppliers, { fields: [supplierPayments.supplierId], references: [suppliers.id] }),
}));
