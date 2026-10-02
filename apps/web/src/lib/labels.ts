import type { Tone } from "@/components/app/status-badge";

/** Etiquetas en español para enums de la base. Cada módulo puede agregar las suyas acá. */
export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  received: { label: "Recibido", tone: "info" },
  confirmed: { label: "Confirmado", tone: "info" },
  in_production: { label: "En producción", tone: "warn" },
  ready: { label: "Listo", tone: "good" },
  dispatched: { label: "Despachado", tone: "warn" },
  delivered: { label: "Entregado", tone: "good" },
  invoiced: { label: "Facturado", tone: "neutral" },
  paid: { label: "Cobrado", tone: "good" },
  cancelled: { label: "Cancelado", tone: "bad" },
};

export const CHANNEL: Record<string, string> = {
  supermarket: "Supermercado",
  reseller: "Revendedor",
  store: "Local propio",
  distributor: "Distribuidor",
  other: "Otro",
};

export const SHAPE: Record<string, string> = {
  tapita: "Tapitas",
  arito: "Aritos",
  lenguita: "Lengüitas",
  mixed: "Surtido",
  sandwich: "Sándwich",
  pizzeta: "Pizzetas",
};

export const PAYMENT_METHOD: Record<string, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  check: "Cheque",
  card: "Tarjeta",
  other: "Otro",
};

export const UNIT: Record<string, string> = { kg: "kg", l: "L", unit: "u." };
