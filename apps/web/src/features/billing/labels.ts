import type { Tone } from "@/components/app/status-badge";

export const INVOICE_TYPE_LABEL: Record<string, string> = {
  A: "Factura A",
  B: "Factura B",
  C: "Factura C",
  X: "Comprobante X",
  NC_A: "Nota de crédito A",
  NC_B: "Nota de crédito B",
  NC_C: "Nota de crédito C",
};

export const CHECK_STATUS: Record<string, { label: string; tone: Tone }> = {
  in_portfolio: { label: "En cartera", tone: "info" },
  deposited: { label: "Depositado", tone: "warn" },
  cashed: { label: "Cobrado", tone: "good" },
  rejected: { label: "Rechazado", tone: "bad" },
  endorsed: { label: "Endosado", tone: "neutral" },
};

/** Acciones disponibles según el estado actual del cheque. */
export const CHECK_ACTIONS: Record<string, { to: string; label: string; destructive?: boolean }[]> = {
  in_portfolio: [
    { to: "deposited", label: "Marcar depositado" },
    { to: "cashed", label: "Marcar cobrado" },
    { to: "endorsed", label: "Endosar" },
    { to: "rejected", label: "Marcar rechazado", destructive: true },
  ],
  deposited: [
    { to: "cashed", label: "Marcar cobrado" },
    { to: "rejected", label: "Marcar rechazado", destructive: true },
  ],
  cashed: [],
  rejected: [],
  endorsed: [],
};

export const INVOICE_STATE: Record<string, { label: string; tone: Tone }> = {
  paid: { label: "Cobrada", tone: "good" },
  current: { label: "A vencer", tone: "info" },
  overdue: { label: "Vencida", tone: "bad" },
};

export const AGING_LABELS = [
  ["current", "A vencer"],
  ["d1_30", "1 a 30 días"],
  ["d31_60", "31 a 60 días"],
  ["d61_90", "61 a 90 días"],
  ["d90_plus", "Más de 90 días"],
] as const;
