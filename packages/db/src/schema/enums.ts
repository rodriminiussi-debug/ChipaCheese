import { pgEnum } from "drizzle-orm/pg-core";

/** Roles del relevamiento ("Usuarios y permisos"). */
export const roleEnum = pgEnum("role", [
  "admin", // Dirección (Nahuel): todo
  "production_manager", // Jefa de producción: todo menos finanzas
  "logistics", // Logística (chofer): despacho y cobros
  "operator", // Operario de planta: carga de su tarea
  "store", // Local comercial
  "technical_lead", // Responsable técnico externo: lectura BPM
  "accountant", // Contadora externa: lectura compras/ventas
]);

export const channelEnum = pgEnum("channel", ["supermarket", "reseller", "store", "distributor", "other"]);
export const unitEnum = pgEnum("unit", ["kg", "l", "unit"]);
export const ingredientCategoryEnum = pgEnum("ingredient_category", [
  "dairy",
  "starch",
  "egg",
  "fat",
  "seasoning",
  "filling",
  "packaging",
  "other",
]);
/**
 * Tipo de producto:
 * - manufactured: chipá elaborado en planta desde la masa (tiene lote y vencimiento).
 * - resale: reventa (gaseosas, aguas…): se compra y se vende tal cual, sin lote.
 * - prepared: elaborado en el local a partir de producto terminado (consume su equivalente al venderse).
 */
export const productKindEnum = pgEnum("product_kind", ["manufactured", "resale", "prepared"]);

export const productShapeEnum = pgEnum("product_shape", [
  "tapita",
  "arito",
  "lenguita",
  "mixed",
  "sandwich",
  "pizzeta",
  "other", // reventa y otros productos que no salen de la masa
]);
export const presentationEnum = pgEnum("presentation", ["bag_500g", "bulk_5kg", "pack", "unit"]);
export const shiftEnum = pgEnum("shift", ["morning", "afternoon"]);

export const locationKindEnum = pgEnum("location_kind", ["raw", "finished", "store", "vehicle"]);
export const stockItemKindEnum = pgEnum("stock_item_kind", ["ingredient", "product"]);
export const stockMovementTypeEnum = pgEnum("stock_movement_type", [
  "receipt", // recepción de materia prima
  "production_consumption", // consumo de insumos en producción
  "production_output", // envasado → producto terminado
  "dispatch", // salida por remito
  "store_sale", // venta en el local
  "transfer", // movimiento entre ubicaciones
  "adjustment", // ajuste de inventario físico
  "return", // devolución de cliente
  "waste", // merma / descarte / donación
]);

export const recipeStatusEnum = pgEnum("recipe_status", ["draft", "active", "archived"]);
export const productionStatusEnum = pgEnum("production_status", [
  "planned",
  "in_progress",
  "freezing",
  "packed",
  "closed",
  "cancelled",
]);
export const planStatusEnum = pgEnum("plan_status", ["draft", "confirmed", "done"]);
export const skillLevelEnum = pgEnum("skill_level", ["learning", "able", "expert"]);
export const taskStageEnum = pgEnum("task_stage", ["preproduction", "machines", "finishing", "cleaning"]);

export const orderStatusEnum = pgEnum("order_status", [
  "received",
  "confirmed",
  "in_production",
  "ready",
  "dispatched",
  "delivered",
  "invoiced",
  "paid",
  "cancelled",
]);
export const orderSourceEnum = pgEnum("order_source", ["whatsapp", "phone", "store", "visit", "other"]);

export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", [
  "draft",
  "sent",
  "partially_received",
  "received",
  "cancelled",
]);
export const documentStatusEnum = pgEnum("document_status", ["draft", "confirmed", "voided"]);
export const documentSourceEnum = pgEnum("document_source", ["manual", "ai", "arca_import"]);
export const invoiceTypeEnum = pgEnum("invoice_type", ["A", "B", "C", "X", "NC_A", "NC_B", "NC_C"]);

export const routeStatusEnum = pgEnum("route_status", ["planned", "in_progress", "done", "cancelled"]);
export const routeStopKindEnum = pgEnum("route_stop_kind", ["delivery", "supplier_pickup", "other"]);
export const dispatchStatusEnum = pgEnum("dispatch_status", [
  "prepared",
  "delivered",
  "rejected",
  "cancelled",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "transfer",
  "check",
  "card",
  "qr",
  "other",
]);
export const checkStatusEnum = pgEnum("check_status", [
  "in_portfolio",
  "deposited",
  "cashed",
  "rejected",
  "endorsed",
]);

export const equipmentKindEnum = pgEnum("equipment_kind", [
  "freezer",
  "fridge",
  "machine",
  "vehicle",
  "other",
]);
export const cleaningResultEnum = pgEnum("cleaning_result", ["ok", "deepen"]);
export const cleaningFrequencyEnum = pgEnum("cleaning_frequency", ["daily", "weekly", "monthly"]);
export const complaintStatusEnum = pgEnum("complaint_status", ["open", "closed"]);
export const maintenanceTypeEnum = pgEnum("maintenance_type", ["preventive", "corrective"]);
export const maintenanceStatusEnum = pgEnum("maintenance_status", ["open", "done", "cancelled"]);

export const replenishmentStatusEnum = pgEnum("replenishment_status", [
  "requested", // el local pide
  "sent", // la planta transfirió (total o parcial)
  "received", // el local confirmó la recepción
  "cancelled",
]);
