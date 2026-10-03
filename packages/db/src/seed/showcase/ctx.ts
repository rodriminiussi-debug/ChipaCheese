import type { IsoDate } from "@chipa/domain";
import type { Tx } from "../../client";
import * as s from "../../schema";
import type { SeedRefs } from "../index";
import * as D from "../data";
import { Rng } from "./rng";

type Ins<T extends { $inferInsert: unknown }> = T["$inferInsert"];

/** Primer día simulado (la producción arranca antes del 01/07 para tener stock) y "hoy" del sistema. */
export const SIM_START: IsoDate = "2026-06-29";
export const TODAY: IsoDate = "2026-10-02";
/** Primer día del período mostrado (julio, agosto, septiembre y octubre parcial). */
export const PERIOD_START: IsoDate = "2026-07-01";

/** Filas a insertar, acumuladas en memoria durante la simulación y volcadas en bloque al final. */
export interface Buffers {
  purchaseOrders: Ins<typeof s.purchaseOrders>[];
  purchaseOrderItems: Ins<typeof s.purchaseOrderItems>[];
  receptions: Ins<typeof s.receptions>[];
  rawLots: Ins<typeof s.rawLots>[];
  purchaseInvoices: Ins<typeof s.purchaseInvoices>[];
  purchaseInvoiceItems: Ins<typeof s.purchaseInvoiceItems>[];
  ingredientPrices: Ins<typeof s.ingredientPrices>[];
  supplierPayments: Ins<typeof s.supplierPayments>[];
  productionPlans: Ins<typeof s.productionPlans>[];
  productionPlanItems: Ins<typeof s.productionPlanItems>[];
  productionRuns: Ins<typeof s.productionRuns>[];
  productionRunWorkers: Ins<typeof s.productionRunWorkers>[];
  productionConsumptions: Ins<typeof s.productionConsumptions>[];
  productionWeighings: Ins<typeof s.productionWeighings>[];
  finishedLots: Ins<typeof s.finishedLots>[];
  packings: Ins<typeof s.packings>[];
  orders: Ins<typeof s.orders>[];
  orderItems: Ins<typeof s.orderItems>[];
  orderEvents: Ins<typeof s.orderEvents>[];
  routes: Ins<typeof s.routes>[];
  routeStops: Ins<typeof s.routeStops>[];
  dispatches: Ins<typeof s.dispatches>[];
  dispatchItems: Ins<typeof s.dispatchItems>[];
  salesInvoices: Ins<typeof s.salesInvoices>[];
  customerPayments: Ins<typeof s.customerPayments>[];
  checks: Ins<typeof s.checks>[];
  storeSales: Ins<typeof s.storeSales>[];
  storeSaleItems: Ins<typeof s.storeSaleItems>[];
  cashClosings: Ins<typeof s.cashClosings>[];
  stockMovements: Ins<typeof s.stockMovements>[];
  cleaningRecords: Ins<typeof s.cleaningRecords>[];
  temperatureLogs: Ins<typeof s.temperatureLogs>[];
  complaints: Ins<typeof s.complaints>[];
  maintenanceOrders: Ins<typeof s.maintenanceOrders>[];
  taskAssignments: Ins<typeof s.taskAssignments>[];
}

export const emptyBuffers = (): Buffers => ({
  purchaseOrders: [],
  purchaseOrderItems: [],
  receptions: [],
  rawLots: [],
  purchaseInvoices: [],
  purchaseInvoiceItems: [],
  ingredientPrices: [],
  supplierPayments: [],
  productionPlans: [],
  productionPlanItems: [],
  productionRuns: [],
  productionRunWorkers: [],
  productionConsumptions: [],
  productionWeighings: [],
  finishedLots: [],
  packings: [],
  orders: [],
  orderItems: [],
  orderEvents: [],
  routes: [],
  routeStops: [],
  dispatches: [],
  dispatchItems: [],
  salesInvoices: [],
  customerPayments: [],
  checks: [],
  storeSales: [],
  storeSaleItems: [],
  cashClosings: [],
  stockMovements: [],
  cleaningRecords: [],
  temperatureLogs: [],
  complaints: [],
  maintenanceOrders: [],
  taskAssignments: [],
});

// --- Estado de stock simulado (espejo en memoria del libro mayor) ------------------------------

export type RawLoc = "seco" | "heladera";
export type FinLoc = "f3" | "f4" | "local";

export interface RawLotState {
  id: string;
  ing: string;
  code: string;
  expiry: IsoDate | null;
  qty: number;
  loc: RawLoc;
  receivedAt: Date;
}

export interface FinishedLotState {
  id: string;
  code: string;
  productionDate: IsoDate;
  expiry: IsoDate;
  runId: string;
}

export interface FinishedPos {
  lot: FinishedLotState;
  product: string;
  loc: FinLoc;
  qty: number;
}

export interface ProductInfo {
  key: string;
  id: string;
  weightKg: number;
  shape: string;
  presentation: string;
}

// --- Pedidos simulados ---------------------------------------------------------------------------

export interface OrderEventRow {
  status: (typeof s.orderStatusEnum.enumValues)[number];
  at: Date;
  by: string | null;
  note?: string | null;
}

export type PayStyle =
  | "on_delivery" // contado: paga al recibir (efectivo o transferencia)
  | "transfer" // transferencia después del vencimiento (con demora propia)
  | "check30" // cheque a 30 días entregado con la factura
  | "check" // mezcla de cheques y transferencias
  | "monthly"; // transferencia en tandas (dos veces por mes)

export interface MixItem {
  product: string;
  min: number;
  max: number;
  step: number;
  prob: number;
}

export interface SimCustomer {
  key: string;
  id: string;
  name: string;
  channel: (typeof s.channelEnum.enumValues)[number];
  zone: "rosario" | "funes" | "pesther";
  priceList: "mayorista" | "super";
  terms: number;
  /** Días de entrega propios (1..7); si falta, los de la zona. */
  weekdays: number[];
  intervalDays: number;
  mix: MixItem[];
  /** Fecha del primer pedido (fecha de recepción). */
  start?: IsoDate;
  /** No recibe pedidos después de esta fecha de recepción (cliente "para llamar"). */
  stop?: IsoDate;
  pay: PayStyle;
  /** Demora de pago sobre el vencimiento (días), [min, max]. */
  lag: [number, number];
  /** Factura B en lugar de A. */
  invoiceB?: boolean;
  /** Cantidad de últimas facturas que quedan sin cobrar. */
  unpaidLast?: number;
  /** Cliente cuyo último cheque rebota. */
  bouncesCheck?: boolean;
  /** Receptor habitual en la entrega. */
  contacts: string[];
}

export interface SimOrder {
  id: string;
  customer: SimCustomer;
  receivedAt: Date;
  /** Fecha de entrega comprometida (ya ajustada por feriados). */
  promised: IsoDate;
  items: { product: string; qty: number; price: number }[];
  total: number;
  source: (typeof s.orderSourceEnum.enumValues)[number];
  notes: string | null;
  createdBy: string;
  state: "open" | "delivered" | "cancelled";
  events: OrderEventRow[];
  /** No sale hasta esta fecha (se usa para el pedido atrasado de "hoy"). */
  holdUntil?: IsoDate;
  deliveredAt?: Date;
  deliveredDate?: IsoDate;
  dispatchId?: string;
  routeId?: string;
  invoiceId?: string;
  big?: boolean;
  kg: number;
}

export interface InvoiceInfo {
  id: string;
  orderId: string | null;
  customerKey: string;
  issueDate: IsoDate;
  dueDate: IsoDate;
  total: number;
  /** Cobros que cubren esta factura: fecha del último y si alguno es un cheque rechazado. */
  paidOn?: IsoDate;
  paidFully: boolean;
}

/** Contexto compartido de la simulación. */
export interface Ctx {
  tx: Tx;
  refs: SeedRefs;
  rng: Rng;
  buf: Buffers;
  users: Record<string, string>;
  loc: Record<string, string>;
  ingId: Record<string, string>;
  products: Record<string, ProductInfo>;
  supplierId: Record<string, string>;
  vehicleId: string;
  /** Puntos de limpieza (id y frecuencia). */
  sanitation: { id: string; element: string; frequency: string }[];
  // estado de stock
  rawLots: Record<string, RawLotState[]>;
  finishedLots: FinishedLotState[];
  finishedPos: FinishedPos[];
  // estado de pedidos
  customers: SimCustomer[];
  orders: SimOrder[];
  invoices: InvoiceInfo[];
  // contadores
  counters: Record<string, number>;
  /** Consumo diario de materia prima (para dimensionar compras). */
  usage: Record<string, { date: IsoDate; qty: number }[]>;
  /** Kilómetros del vehículo. */
  odometer: number;
  /** Producciones esperando envasado (corrida de ayer o del viernes). */
  unpackedRuns: UnpackedRun[];
  /** Lote de producto por fecha (para reclamos y trazabilidad). */
  lotByDate: Record<IsoDate, FinishedLotState>;
  /** Hora de cierre de la ruta de cada día (los retiros en proveedores se recepcionan después). */
  routeEnd: Record<IsoDate, Date>;
  /** Facturas de compra pendientes de pago. */
  payables: { supplier: string; invoiceId: string; due: IsoDate; total: number; paid: boolean }[];
}

export interface UnpackedRun {
  runId: string;
  date: IsoDate;
  runNumber: number;
  /** Unidades a envasar por producto. */
  units: Record<string, number>;
}

export const BLANK_PRODUCT_KEYS = [
  "tap500",
  "ari500",
  "len500",
  "sur500",
  "tap5k",
  "ari5k",
  "len5k",
] as const;

export function createCtx(tx: Tx, refs: SeedRefs, vehicleId: string, seed = 20260702): Ctx {
  const products: Record<string, ProductInfo> = {};
  for (const p of D.PRODUCTS) {
    products[p.key] = {
      key: p.key,
      id: refs.products[p.key]!,
      weightKg: p.netWeightKg,
      shape: p.shape,
      presentation: p.presentation,
    };
  }
  return {
    tx,
    refs,
    rng: new Rng(seed),
    buf: emptyBuffers(),
    users: refs.users,
    loc: refs.locations,
    ingId: refs.ingredients,
    products,
    supplierId: refs.suppliers,
    vehicleId,
    sanitation: [],
    rawLots: {},
    finishedLots: [],
    finishedPos: [],
    customers: [],
    orders: [],
    invoices: [],
    counters: {},
    usage: {},
    odometer: 63_480,
    unpackedRuns: [],
    lotByDate: {},
    routeEnd: {},
    payables: [],
  };
}

/** Contador con nombre (números de factura, remito, OC…). */
export function nextNumber(ctx: Ctx, name: string, start: number): number {
  const n = (ctx.counters[name] ?? start - 1) + 1;
  ctx.counters[name] = n;
  return n;
}

/** createdAt/updatedAt coherentes con el momento del hecho. */
export const stamp = (d: Date) => ({ createdAt: d, updatedAt: d });
