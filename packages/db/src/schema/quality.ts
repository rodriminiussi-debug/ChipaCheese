import { relations } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { day, id, money, pct, timestamps, tstz } from "./_columns";
import {
  cleaningFrequencyEnum,
  cleaningResultEnum,
  complaintStatusEnum,
  maintenanceStatusEnum,
  maintenanceTypeEnum,
} from "./enums";
import { users } from "./auth";
import { customers, equipment } from "./catalog";
import { finishedLots } from "./production";

/** Puntos de la planilla de limpieza: sector × elemento (RF-34). */
export const sanitationPoints = pgTable("sanitation_points", {
  id: id(),
  sector: text().notNull(),
  element: text().notNull(),
  frequency: cleaningFrequencyEnum().notNull().default("daily"),
  equipmentId: uuid().references(() => equipment.id),
  sortOrder: integer().notNull().default(0),
  active: boolean().notNull().default(true),
  ...timestamps(),
});

export const cleaningRecords = pgTable(
  "cleaning_records",
  {
    id: id(),
    pointId: uuid()
      .notNull()
      .references(() => sanitationPoints.id),
    /** Día al que corresponde la limpieza (puede diferir del día de carga). */
    date: day().notNull(),
    result: cleaningResultEnum().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    recordedAt: tstz().notNull().defaultNow(),
    /** Carga tardía: se registró un día pasado (RF-34). */
    lateEntry: boolean().notNull().default(false),
    notes: text(),
    /** uuid generado en la tablet: idempotencia al reenviar desde la cola offline. */
    clientId: uuid().unique(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("cleaning_records_uq").on(t.pointId, t.date),
    index("cleaning_records_date_idx").on(t.date),
  ],
);

/** Registro de temperaturas de F1–F4, heladera y vehículo (RF-34, RF-38). */
export const temperatureLogs = pgTable(
  "temperature_logs",
  {
    id: id(),
    equipmentId: uuid()
      .notNull()
      .references(() => equipment.id),
    date: day().notNull(),
    measuredAt: tstz().notNull().defaultNow(),
    valueC: pct().notNull(),
    outOfRange: boolean().notNull().default(false),
    userId: uuid().references(() => users.id),
    /** manual | sensor (fase 3) */
    source: text().notNull().default("manual"),
    lateEntry: boolean().notNull().default(false),
    correctiveAction: text(),
    /** uuid generado en la tablet: idempotencia al reenviar desde la cola offline. */
    clientId: uuid().unique(),
    ...timestamps(),
  },
  (t) => [index("temperature_logs_equipment_idx").on(t.equipmentId, t.measuredAt)],
);

/** Reclamos y devoluciones (planilla BPM versión 2022). */
export const complaints = pgTable(
  "complaints",
  {
    id: id(),
    date: day().notNull(),
    customerId: uuid().references(() => customers.id),
    finishedLotId: uuid().references(() => finishedLots.id),
    qtyUnits: integer(),
    reason: text().notNull(),
    customerAction: text(),
    productAction: text(),
    status: complaintStatusEnum().notNull().default("open"),
    supervisorId: uuid().references(() => users.id),
    userId: uuid().references(() => users.id),
    ...timestamps(),
  },
  (t) => [index("complaints_lot_idx").on(t.finishedLotId)],
);

/** Plan preventivo por equipo (RF-37). */
export const maintenancePlans = pgTable("maintenance_plans", {
  id: id(),
  equipmentId: uuid()
    .notNull()
    .references(() => equipment.id),
  task: text().notNull(),
  frequencyDays: integer().notNull(),
  startDate: day().notNull(),
  lastDoneAt: day(),
  active: boolean().notNull().default(true),
  ...timestamps(),
});

/** Trabajos de mantenimiento (preventivos y correctivos). */
export const maintenanceOrders = pgTable(
  "maintenance_orders",
  {
    id: id(),
    equipmentId: uuid()
      .notNull()
      .references(() => equipment.id),
    planId: uuid().references(() => maintenancePlans.id),
    type: maintenanceTypeEnum().notNull(),
    status: maintenanceStatusEnum().notNull().default("open"),
    activity: text().notNull(),
    cause: text(),
    spareParts: text(),
    cost: money(),
    date: day().notNull(),
    doneAt: day(),
    responsibleId: uuid().references(() => users.id),
    supervisorId: uuid().references(() => users.id),
    downtimeMinutes: integer(),
    /** Quien avisó la falla (operario, chofer, local) y cuándo. */
    reportedById: uuid().references(() => users.id),
    reportedAt: tstz(),
    ...timestamps(),
  },
  (t) => [index("maintenance_orders_equipment_idx").on(t.equipmentId, t.date)],
);

export const sanitationPointsRelations = relations(sanitationPoints, ({ one, many }) => ({
  equipment: one(equipment, { fields: [sanitationPoints.equipmentId], references: [equipment.id] }),
  records: many(cleaningRecords),
}));
export const cleaningRecordsRelations = relations(cleaningRecords, ({ one }) => ({
  point: one(sanitationPoints, { fields: [cleaningRecords.pointId], references: [sanitationPoints.id] }),
  user: one(users, { fields: [cleaningRecords.userId], references: [users.id] }),
}));
export const temperatureLogsRelations = relations(temperatureLogs, ({ one }) => ({
  equipment: one(equipment, { fields: [temperatureLogs.equipmentId], references: [equipment.id] }),
  user: one(users, { fields: [temperatureLogs.userId], references: [users.id] }),
}));
export const complaintsRelations = relations(complaints, ({ one }) => ({
  customer: one(customers, { fields: [complaints.customerId], references: [customers.id] }),
  lot: one(finishedLots, { fields: [complaints.finishedLotId], references: [finishedLots.id] }),
  supervisor: one(users, {
    fields: [complaints.supervisorId],
    references: [users.id],
    relationName: "complaint_supervisor",
  }),
  user: one(users, { fields: [complaints.userId], references: [users.id], relationName: "complaint_user" }),
}));
export const maintenancePlansRelations = relations(maintenancePlans, ({ one, many }) => ({
  equipment: one(equipment, { fields: [maintenancePlans.equipmentId], references: [equipment.id] }),
  orders: many(maintenanceOrders),
}));
export const maintenanceOrdersRelations = relations(maintenanceOrders, ({ one }) => ({
  equipment: one(equipment, { fields: [maintenanceOrders.equipmentId], references: [equipment.id] }),
  plan: one(maintenancePlans, { fields: [maintenanceOrders.planId], references: [maintenancePlans.id] }),
  responsible: one(users, {
    fields: [maintenanceOrders.responsibleId],
    references: [users.id],
    relationName: "mo_responsible",
  }),
  supervisor: one(users, {
    fields: [maintenanceOrders.supervisorId],
    references: [users.id],
    relationName: "mo_supervisor",
  }),
}));
