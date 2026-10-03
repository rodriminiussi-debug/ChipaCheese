import { z } from "zod";
import { ORDER_STATUSES } from "@chipa/domain";
import { clientIdField, int, isoDate, optText, optUuid, recordedAtField } from "@/lib/zod";

export const ORDER_SOURCES = ["whatsapp", "phone", "store", "visit", "other"] as const;

/** Una línea del pedido: producto y cantidad de unidades de venta (bolsas, packs…). */
export const orderItemInput = z.object({
  productId: z.string().uuid(),
  qtyUnits: int({ min: 1, max: 100_000 }),
});

/** RF-02: alta de pedido. Esquema compartido cliente/servidor (idempotente). */
export const createOrderInput = z.object({
  customerId: z.string().uuid("Elegí un cliente"),
  promisedDate: isoDate(),
  source: z.enum(ORDER_SOURCES).default("whatsapp"),
  notes: optText(),
  items: z.array(orderItemInput).min(1, "Agregá al menos un producto"),
});
export type CreateOrderInput = z.input<typeof createOrderInput>;
export type CreateOrderData = z.output<typeof createOrderInput>;

/**
 * Pedido cargado desde el celular, encolable sin señal: `clientId` (uuid del celular; idempotencia al reenviar
 * desde la cola) y `recordedAt` (momento real en que se tomó el pedido). Ver `src/lib/offline-queue.ts`.
 */
export const createOrderPayload = createOrderInput.extend({
  clientId: clientIdField(),
  recordedAt: recordedAtField(),
});
export type CreateOrderPayload = z.input<typeof createOrderPayload>;

/** RF-03: edición de ítems (solo recibido/confirmado). */
export const updateOrderInput = z.object({
  id: z.string().uuid(),
  promisedDate: isoDate(),
  notes: optText(),
  items: z.array(orderItemInput).min(1, "Agregá al menos un producto"),
});
export type UpdateOrderInput = z.input<typeof updateOrderInput>;
export type UpdateOrderData = z.output<typeof updateOrderInput>;

/** RF-03: cambio de estado. */
export const transitionOrderInput = z
  .object({
    id: z.string().uuid(),
    to: z.enum(ORDER_STATUSES),
    note: optText(),
  })
  // Cancelar un pedido exige el motivo (queda en el historial).
  .refine((v) => v.to !== "cancelled" || !!v.note, {
    message: "Indicá el motivo de la cancelación",
    path: ["note"],
  });
export type TransitionOrderData = z.output<typeof transitionOrderInput>;

/** RF-05: usar la fecha posible como fecha comprometida. */
export const setPromisedDateInput = z.object({ id: z.string().uuid(), date: isoDate() });

/** RF-05: consulta de fecha posible para un pedido a medio cargar. */
export const estimateOrderInput = z.object({
  items: z.array(orderItemInput).default([]),
  excludeOrderId: optUuid(),
});
export type EstimateOrderInput = z.input<typeof estimateOrderInput>;

/** Filtros del listado `/pedidos` (vienen de la URL; todo opcional). */
export interface OrderFilters {
  status?: (typeof ORDER_STATUSES)[number];
  customerId?: string;
  from?: string;
  to?: string;
  overdue?: boolean;
}
