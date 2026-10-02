/** Etiquetas en español de personas y tareas (RF-23). */
export const TASK_STAGE: Record<string, string> = {
  preproduction: "Preproducción",
  machines: "Máquinas",
  finishing: "Terminación",
  cleaning: "Limpieza",
};

export const STAGE_ORDER = ["preproduction", "machines", "finishing", "cleaning"] as const;

export const SKILL_LEVEL: Record<string, string> = {
  learning: "Aprendiendo",
  able: "Puede",
  expert: "Experto",
};
