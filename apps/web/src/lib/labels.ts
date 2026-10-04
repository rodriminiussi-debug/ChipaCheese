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
  other: "Otro",
};

/** Tipo de producto (ver productKindEnum). */
export const PRODUCT_KIND: Record<string, { label: string; hint: string }> = {
  manufactured: {
    label: "Fabricado",
    hint: "Chipá hecho en planta desde la masa: tiene lote y vencimiento.",
  },
  resale: { label: "Reventa", hint: "Se compra y se vende tal cual (gaseosas, aguas…)." },
  prepared: {
    label: "Elaborado en el local",
    hint: "Se prepara con producto terminado; al venderse descuenta su equivalente.",
  },
};

export const PAYMENT_METHOD: Record<string, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  check: "Cheque",
  card: "Tarjeta",
  qr: "QR / billetera virtual",
  other: "Otro",
};

export const UNIT: Record<string, string> = { kg: "kg", l: "L", unit: "u." };
