import { relations } from "drizzle-orm";
import { index, integer, pgTable, serial, text, uuid } from "drizzle-orm/pg-core";
import { day, id, money, pct, qty, timestamps, tstz } from "./_columns";
import { dispatchStatusEnum, routeStatusEnum, routeStopKindEnum } from "./enums";
import { users } from "./auth";
import { customers, products, suppliers, vehicles } from "./catalog";
import { finishedLots } from "./production";
import { orders } from "./sales";

/** Salida de reparto / hoja de ruta (RF-24, RF-26). */
export const routes = pgTable(
  "routes",
  {
    id: id(),
    date: day().notNull(),
    driverId: uuid().references(() => users.id),
    vehicleId: uuid().references(() => vehicles.id),
    status: routeStatusEnum().notNull().default("planned"),
    kmStart: qty(),
    kmEnd: qty(),
    startedAt: tstz(),
    endedAt: tstz(),
    fuelLiters: qty(),
    fuelCost: money(),
    otherCosts: money(),
    /** Temperatura del equipo de frío medida en el trayecto. */
    coldUnitTempC: pct(),
    notes: text(),
    ...timestamps(),
  },
  (t) => [index("routes_date_idx").on(t.date)],
);

export const routeStops = pgTable(
  "route_stops",
  {
    id: id(),
    routeId: uuid()
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    kind: routeStopKindEnum().notNull(),
    orderId: uuid().references(() => orders.id),
    customerId: uuid().references(() => customers.id),
    supplierId: uuid().references(() => suppliers.id),
    notes: text(),
    doneAt: tstz(),
    ...timestamps(),
  },
  (t) => [index("route_stops_route_idx").on(t.routeId, t.seq)],
);

/** Remito (RF-25). Su detalle por lote alimenta el registro de despacho BPM (RF-28). */
export const dispatches = pgTable(
  "dispatches",
  {
    id: id(),
    number: serial().notNull().unique(),
    routeId: uuid().references(() => routes.id),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    status: dispatchStatusEnum().notNull().default("prepared"),
    dispatchedAt: tstz().notNull().defaultNow(),
    deliveredAt: tstz(),
    responsibleId: uuid().references(() => users.id),
    receivedByName: text(),
    /** Foto o firma de conformidad en el storage. */
    proofFileKey: text(),
    notes: text(),
    ...timestamps(),
  },
  (t) => [index("dispatches_order_idx").on(t.orderId), index("dispatches_route_idx").on(t.routeId)],
);

export const dispatchItems = pgTable(
  "dispatch_items",
  {
    id: id(),
    dispatchId: uuid()
      .notNull()
      .references(() => dispatches.id, { onDelete: "cascade" }),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    finishedLotId: uuid()
      .notNull()
      .references(() => finishedLots.id),
    qtyUnits: integer().notNull(),
    /** Unidades realmente entregadas (RF-25). Null = se entregó todo `qtyUnits`. */
    qtyDelivered: integer(),
    /** Motivo del cambio manual del lote asignado por FEFO (RF-25). Null = asignación automática. */
    lotChangeReason: text(),
    ...timestamps(),
  },
  (t) => [
    index("dispatch_items_lot_idx").on(t.finishedLotId),
    index("dispatch_items_dispatch_idx").on(t.dispatchId),
  ],
);

export const routesRelations = relations(routes, ({ one, many }) => ({
  driver: one(users, { fields: [routes.driverId], references: [users.id] }),
  vehicle: one(vehicles, { fields: [routes.vehicleId], references: [vehicles.id] }),
  stops: many(routeStops),
  dispatches: many(dispatches),
}));
export const routeStopsRelations = relations(routeStops, ({ one }) => ({
  route: one(routes, { fields: [routeStops.routeId], references: [routes.id] }),
  order: one(orders, { fields: [routeStops.orderId], references: [orders.id] }),
  customer: one(customers, { fields: [routeStops.customerId], references: [customers.id] }),
  supplier: one(suppliers, { fields: [routeStops.supplierId], references: [suppliers.id] }),
}));
export const dispatchesRelations = relations(dispatches, ({ one, many }) => ({
  route: one(routes, { fields: [dispatches.routeId], references: [routes.id] }),
  order: one(orders, { fields: [dispatches.orderId], references: [orders.id] }),
  customer: one(customers, { fields: [dispatches.customerId], references: [customers.id] }),
  responsible: one(users, { fields: [dispatches.responsibleId], references: [users.id] }),
  items: many(dispatchItems),
}));
export const dispatchItemsRelations = relations(dispatchItems, ({ one }) => ({
  dispatch: one(dispatches, { fields: [dispatchItems.dispatchId], references: [dispatches.id] }),
  product: one(products, { fields: [dispatchItems.productId], references: [products.id] }),
  lot: one(finishedLots, { fields: [dispatchItems.finishedLotId], references: [finishedLots.id] }),
}));
