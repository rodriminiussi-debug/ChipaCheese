import type { Tone } from "@/components/app/status-badge";

/** Etiquetas en español de los enums del módulo de compras. */
export const INVOICE_TYPE: Record<string, string> = {
  A: "Factura A",
  B: "Factura B",
  C: "Factura C",
  X: "Comprobante X",
  NC_A: "Nota de crédito A",
  NC_B: "Nota de crédito B",
  NC_C: "Nota de crédito C",
};

export const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Borrador", tone: "warn" },
  confirmed: { label: "Confirmada", tone: "good" },
  voided: { label: "Anulada", tone: "bad" },
};

export const INVOICE_SOURCE: Record<string, string> = {
  manual: "Carga manual",
  ai: "Leída por IA",
  arca_import: "ARCA",
};

export const PO_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Borrador", tone: "neutral" },
  sent: { label: "Enviada", tone: "info" },
  partially_received: { label: "Recibida parcial", tone: "warn" },
  received: { label: "Recibida", tone: "good" },
  cancelled: { label: "Cancelada", tone: "bad" },
};

export const INGREDIENT_CATEGORY: Record<string, string> = {
  dairy: "Lácteos",
  starch: "Féculas",
  egg: "Huevos",
  fat: "Grasas",
  seasoning: "Condimentos",
  filling: "Rellenos",
  packaging: "Envases",
  other: "Otros",
};

export const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** "2026-10" → "octubre 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
}
