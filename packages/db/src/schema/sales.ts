import { relations } from "drizzle-orm";
import { index, integer, pgTable, serial, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { day, id, money, timestamps, tstz } from "./_columns";
import {
  checkStatusEnum,
  documentSourceEnum,
  documentStatusEnum,
  invoiceTypeEnum,
  orderSourceEnum,
  orderStatusEnum,
  paymentMethodEnum,
  replenishmentStatusEnum,
} from "./enums";
import { users } from "./auth";
import { customers, locations, priceLists, products } from "./catalog";
import { finishedLots } from "./production";
import { routes } from "./dispatch";

/** Pedido de cliente (M1). */
export const orders = pgTable(
  "orders",
  {
    id: id(),
    number: serial().notNull().unique(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    priceListId: uuid().references(() => priceLists.id),
    source: orderSourceEnum().notNull().default("whatsapp"),
    receivedAt: tstz().notNull().defaultNow(),
    /** Fecha de entrega comprometida (RF-02). */
    promisedDate: day().notNull(),
    status: orderStatusEnum().notNull().default("received"),
    deliveredAt: tstz(),
    total: money().notNull().default(0),
    notes: text(),
    createdById: uuid().references(() => users.id),
    /** uuid generado en el celular: idempotencia al reenviar el pedido desde la cola offline. */
    clientId: uuid().unique(),
    ...timestamps(),
  },
  (t) => [
    index("orders_customer_idx").on(t.customerId, t.receivedAt),
    index("orders_status_idx").on(t.status),
    index("orders_promised_idx").on(t.promisedDate),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    qtyUnits: integer().notNull(),
    unitPrice: money().notNull(),
    ...timestamps(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

/** Historial de estados del pedido (para KPI de entregas a tiempo). */
export const orderEvents = pgTable(
  "order_events",
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    status: orderStatusEnum().notNull(),
    at: tstz().notNull().defaultNow(),
    byId: uuid().references(() => users.id),
    note: text(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId)],
);

/** Factura emitida a cliente (ARCA). RF-30/32. */
export const salesInvoices = pgTable(
  "sales_invoices",
  {
    id: id(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    orderId: uuid().references(() => orders.id),
    invoiceType: invoiceTypeEnum().notNull(),
    pointOfSale: text().notNull(),
    number: text().notNull(),
    issueDate: day().notNull(),
    dueDate: day().notNull(),
    netTotal: money().notNull().default(0),
    vatTotal: money().notNull().default(0),
    total: money().notNull(),
    cae: text(),
    status: documentStatusEnum().notNull().default("confirmed"),
    source: documentSourceEnum().notNull().default("manual"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("sales_invoices_number_uq").on(t.invoiceType, t.pointOfSale, t.number),
    index("sales_invoices_customer_idx").on(t.customerId, t.dueDate),
  ],
);

/** Cobro a cliente (en ruta, en oficina o en el local). RF-31. */
export const customerPayments = pgTable(
  "customer_payments",
  {
    id: id(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    date: day().notNull(),
    amount: money().notNull(),
    method: paymentMethodEnum().notNull(),
    /** Ruta en la que se cobró. */
    routeId: uuid().references(() => routes.id),
    receivedById: uuid().references(() => users.id),
    reference: text(),
    notes: text(),
    ...timestamps(),
  },
  (t) => [index("customer_payments_customer_idx").on(t.customerId, t.date)],
);

/** Cheques en cartera. */
export const checks = pgTable(
  "checks",
  {
    id: id(),
    paymentId: uuid()
      .notNull()
      .references(() => customerPayments.id, { onDelete: "cascade" }),
    bank: text().notNull(),
    number: text().notNull(),
    issuer: text(),
    amount: money().notNull(),
    issueDate: day(),
    /** Fecha a partir de la cual se puede cobrar. */
    cashDate: day().notNull(),
    status: checkStatusEnum().notNull().default("in_portfolio"),
    notes: text(),
    ...timestamps(),
  },
  (t) => [index("checks_cash_date_idx").on(t.cashDate, t.status)],
);

/** Venta del local (RF-33). */
export const storeSales = pgTable(
  "store_sales",
  {
    id: id(),
    soldAt: tstz().notNull().defaultNow(),
    locationId: uuid()
      .notNull()
      .references(() => locations.id),
    customerId: uuid().references(() => customers.id),
    method: paymentMethodEnum().notNull(),
    total: money().notNull(),
    sellerId: uuid().references(() => users.id),
    /** Anulación (venta cargada por error): devuelve el stock; queda en la auditoría. */
    voidedAt: tstz(),
    voidedById: uuid().references(() => users.id),
    voidReason: text(),
    ...timestamps(),
  },
  (t) => [index("store_sales_sold_at_idx").on(t.soldAt)],
);

/**
 * Cómo se pagó una venta del local: una fila por medio (pago dividido = dos filas). La suma de los
 * montos es el total de la venta; `store_sales.method` queda con el medio principal (el de mayor monto).
 */
export const storeSalePayments = pgTable(
  "store_sale_payments",
  {
    id: id(),
    saleId: uuid()
      .notNull()
      .references(() => storeSales.id, { onDelete: "cascade" }),
    method: paymentMethodEnum().notNull(),
    amount: money().notNull(),
    ...timestamps(),
  },
  (t) => [index("store_sale_payments_sale_idx").on(t.saleId)],
);

export const storeSaleItems = pgTable("store_sale_items", {
  id: id(),
  saleId: uuid()
    .notNull()
    .references(() => storeSales.id, { onDelete: "cascade" }),
  productId: uuid()
    .notNull()
    .references(() => products.id),
  finishedLotId: uuid().references(() => finishedLots.id),
  qtyUnits: integer().notNull(),
  unitPrice: money().notNull(),
  ...timestamps(),
});

/** Cierre de caja diario del local. */
export const cashClosings = pgTable(
  "cash_closings",
  {
    id: id(),
    date: day().notNull(),
    locationId: uuid()
      .notNull()
      .references(() => locations.id),
    expectedCash: money().notNull(),
    countedCash: money().notNull(),
    expectedTransfer: money().notNull().default(0),
    /** Tarjeta y QR del día: informativos (se concilian contra el resumen del procesador). */
    expectedCard: money().notNull().default(0),
    expectedQr: money().notNull().default(0),
    closedById: uuid().references(() => users.id),
    notes: text(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("cash_closings_uq").on(t.date, t.locationId)],
);

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  priceList: one(priceLists, { fields: [orders.priceListId], references: [priceLists.id] }),
  createdBy: one(users, { fields: [orders.createdById], references: [users.id] }),
  items: many(orderItems),
  events: many(orderEvents),
  invoices: many(salesInvoices),
}));
export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));
export const orderEventsRelations = relations(orderEvents, ({ one }) => ({
  order: one(orders, { fields: [orderEvents.orderId], references: [orders.id] }),
  by: one(users, { fields: [orderEvents.byId], references: [users.id] }),
}));
export const salesInvoicesRelations = relations(salesInvoices, ({ one }) => ({
  customer: one(customers, { fields: [salesInvoices.customerId], references: [customers.id] }),
  order: one(orders, { fields: [salesInvoices.orderId], references: [orders.id] }),
}));
export const customerPaymentsRelations = relations(customerPayments, ({ one, many }) => ({
  customer: one(customers, { fields: [customerPayments.customerId], references: [customers.id] }),
  receivedBy: one(users, { fields: [customerPayments.receivedById], references: [users.id] }),
  route: one(routes, { fields: [customerPayments.routeId], references: [routes.id] }),
  checks: many(checks),
}));
export const checksRelations = relations(checks, ({ one }) => ({
  payment: one(customerPayments, { fields: [checks.paymentId], references: [customerPayments.id] }),
}));
export const storeSalesRelations = relations(storeSales, ({ one, many }) => ({
  location: one(locations, { fields: [storeSales.locationId], references: [locations.id] }),
  seller: one(users, { fields: [storeSales.sellerId], references: [users.id] }),
  customer: one(customers, { fields: [storeSales.customerId], references: [customers.id] }),
  voidedBy: one(users, { fields: [storeSales.voidedById], references: [users.id] }),
  items: many(storeSaleItems),
  payments: many(storeSalePayments),
}));
export const storeSalePaymentsRelations = relations(storeSalePayments, ({ one }) => ({
  sale: one(storeSales, { fields: [storeSalePayments.saleId], references: [storeSales.id] }),
}));
export const storeSaleItemsRelations = relations(storeSaleItems, ({ one }) => ({
  sale: one(storeSales, { fields: [storeSaleItems.saleId], references: [storeSales.id] }),
  product: one(products, { fields: [storeSaleItems.productId], references: [products.id] }),
  lot: one(finishedLots, { fields: [storeSaleItems.finishedLotId], references: [finishedLots.id] }),
}));
export const cashClosingsRelations = relations(cashClosings, ({ one }) => ({
  location: one(locations, { fields: [cashClosings.locationId], references: [locations.id] }),
  closedBy: one(users, { fields: [cashClosings.closedById], references: [users.id] }),
}));

/** Pedido de reposición del local a la planta (transferencia F3/F4 → LOCAL). */
export const storeReplenishments = pgTable(
  "store_replenishments",
  {
    id: id(),
    number: serial().notNull().unique(),
    status: replenishmentStatusEnum().notNull().default("requested"),
    requestedById: uuid().references(() => users.id),
    requestedAt: tstz().notNull().defaultNow(),
    /** Fecha en que el local necesita la mercadería. */
    neededBy: day(),
    sentById: uuid().references(() => users.id),
    sentAt: tstz(),
    receivedById: uuid().references(() => users.id),
    receivedAt: tstz(),
    notes: text(),
    ...timestamps(),
  },
  (t) => [index("store_replenishments_status_idx").on(t.status)],
);

export const storeReplenishmentItems = pgTable("store_replenishment_items", {
  id: id(),
  replenishmentId: uuid()
    .notNull()
    .references(() => storeReplenishments.id, { onDelete: "cascade" }),
  productId: uuid()
    .notNull()
    .references(() => products.id),
  qtyRequested: integer().notNull(),
  qtySent: integer(),
  ...timestamps(),
});

export const storeReplenishmentsRelations = relations(storeReplenishments, ({ many, one }) => ({
  items: many(storeReplenishmentItems),
  requestedBy: one(users, { fields: [storeReplenishments.requestedById], references: [users.id] }),
  sentBy: one(users, { fields: [storeReplenishments.sentById], references: [users.id] }),
  receivedBy: one(users, { fields: [storeReplenishments.receivedById], references: [users.id] }),
}));
export const storeReplenishmentItemsRelations = relations(storeReplenishmentItems, ({ one }) => ({
  replenishment: one(storeReplenishments, {
    fields: [storeReplenishmentItems.replenishmentId],
    references: [storeReplenishments.id],
  }),
  product: one(products, { fields: [storeReplenishmentItems.productId], references: [products.id] }),
}));
