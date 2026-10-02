import type { Tone } from "@/components/app/status-badge";

/** Etiquetas en español del módulo de producción (M4). */
export const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  planned: { label: "Planificada", tone: "neutral" },
  in_progress: { label: "En elaboración", tone: "info" },
  freezing: { label: "Congelando", tone: "warn" },
  packed: { label: "Envasada", tone: "good" },
  closed: { label: "Cerrada", tone: "neutral" },
  cancelled: { label: "Cancelada", tone: "bad" },
};

/** Texto del botón que lleva la producción al estado indicado. */
export const RUN_STATUS_ACTION: Record<string, string> = {
  in_progress: "Iniciar elaboración",
  freezing: "Pasar a congelado",
  packed: "Marcar envasada",
  closed: "Cerrar producción",
  cancelled: "Cancelar producción",
};

export const SHIFT: Record<string, string> = { morning: "Mañana", afternoon: "Tarde" };

export const PLAN_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Borrador", tone: "neutral" },
  confirmed: { label: "Confirmado", tone: "good" },
  done: { label: "Cumplido", tone: "info" },
};

export const RECIPE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Borrador", tone: "neutral" },
  active: { label: "Activa", tone: "good" },
  archived: { label: "Archivada", tone: "neutral" },
};

export const CONSUMPTION_REASON: Record<string, string> = {
  in_range: "Dentro del rango",
  within_threshold: "Dentro del umbral",
  below_range: "Por debajo del rango de la receta",
  above_range: "Por encima del rango de la receta",
  over_threshold: "Desvío mayor al umbral",
};

export const FREEZER_CODES = ["F1", "F2"] as const;
