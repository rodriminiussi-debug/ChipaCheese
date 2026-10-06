import type { StoreStockStatus } from "@chipa/domain";

export const STORE_METHOD_OPTIONS = [
  { value: "cash", label: "Efectivo" },
  { value: "transfer", label: "Transferencia" },
  { value: "card", label: "Tarjeta", hint: "Débito o crédito" },
  { value: "qr", label: "QR / billetera", hint: "Mercado Pago, MODO, etc." },
] as const;

export const STORE_METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
  qr: "QR / billetera",
  check: "Cheque",
  other: "Otro",
};

export const STORE_STATUS: Record<
  StoreStockStatus,
  { label: string; tone: "bad" | "warn" | "good" | "neutral" }
> = {
  out: { label: "Agotado", tone: "bad" },
  reorder: { label: "Reponer", tone: "warn" },
  ok: { label: "OK", tone: "good" },
  no_sales: { label: "Sin ventas", tone: "neutral" },
};

export const REPLENISHMENT_STATUS: Record<
  string,
  { label: string; tone: "info" | "warn" | "good" | "neutral" | "bad" }
> = {
  requested: { label: "Pedida", tone: "warn" },
  sent: { label: "Enviada", tone: "info" },
  received: { label: "Recibida", tone: "good" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};
