import type { Tone } from "@/components/app/status-badge";

export const CLEANING_RESULT: Record<string, { label: string; short: string; tone: Tone }> = {
  ok: { label: "Correcto", short: "x", tone: "good" },
  deepen: { label: "A profundizar", short: "P", tone: "warn" },
};

export const CLEANING_FREQUENCY: Record<string, string> = {
  daily: "Diaria",
  weekly: "Semanal",
  monthly: "Mensual",
};

export const COMPLAINT_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Abierto", tone: "warn" },
  closed: { label: "Cerrado", tone: "good" },
};

export const EQUIPMENT_KIND: Record<string, string> = {
  freezer: "Freezer",
  fridge: "Heladera",
  machine: "Máquina",
  vehicle: "Vehículo",
  other: "Otro",
};

/** Texto de un rango de temperatura: "≤ −18 °C", "0 a 5 °C". */
export function rangeLabel(min: number | null, max: number | null): string {
  const f = (n: number) => n.toLocaleString("es-AR").replace("-", "−");
  if (min != null && max != null) return `${f(min)} a ${f(max)} °C`;
  if (max != null) return `≤ ${f(max)} °C`;
  if (min != null) return `≥ ${f(min)} °C`;
  return "sin rango";
}

/** Temperatura con coma decimal y signo menos tipográfico: "−18,5 °C". */
export function tempLabel(v: number): string {
  return `${v.toLocaleString("es-AR", { maximumFractionDigits: 1 }).replace("-", "−")} °C`;
}
