import type { Tone } from "@/components/app/status-badge";

export const PLAN_STATUS: Record<"ok" | "due_soon" | "overdue", { label: string; tone: Tone }> = {
  ok: { label: "Al día", tone: "good" },
  due_soon: { label: "Por vencer", tone: "warn" },
  overdue: { label: "Vencido", tone: "bad" },
};

export const ORDER_TYPE: Record<string, string> = {
  preventive: "Preventivo",
  corrective: "Correctivo",
};

export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Abierta", tone: "warn" },
  done: { label: "Cerrada", tone: "good" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};

/** "cada 30 días", "cada 3 meses", "cada 6 meses", "anual"… para frecuencias redondas. */
export function frequencyLabel(days: number): string {
  if (days === 7) return "semanal";
  if (days === 365) return "anual";
  if (days % 30 === 0 && days >= 60) return `cada ${days / 30} meses`;
  return `cada ${days} días`;
}

/** "en 5 días", "hoy", "hace 3 días". */
export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft === 0) return "hoy";
  if (daysLeft > 0) return `en ${daysLeft} día${daysLeft === 1 ? "" : "s"}`;
  return `hace ${-daysLeft} día${daysLeft === -1 ? "" : "s"}`;
}

export function downtimeLabel(minutes: number | null): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
