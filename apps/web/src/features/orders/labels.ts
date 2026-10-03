import type { OrderStatus } from "@chipa/domain";

/** Texto del botón que lleva el pedido a cada estado (RF-03). */
export const TRANSITION_LABEL: Record<OrderStatus, string> = {
  received: "Marcar recibido",
  confirmed: "Confirmar pedido",
  in_production: "Pasar a producción",
  ready: "Marcar listo",
  dispatched: "Despachar",
  delivered: "Marcar entregado",
  invoiced: "Marcar facturado",
  paid: "Marcar cobrado",
  cancelled: "Cancelar pedido",
};

export const ORDER_SOURCE: Record<string, string> = {
  whatsapp: "WhatsApp",
  phone: "Teléfono",
  store: "Local",
  visit: "Visita",
  other: "Otro",
};
