import { z } from "zod";
import { isoDate } from "@/lib/zod";

/** Esquemas compartidos cliente/servidor del pizarrón y la matriz de polivalencia (RF-23). */

export const SKILL_LEVELS = ["learning", "able", "expert"] as const;

export const toggleAssignmentInput = z.object({
  date: isoDate(),
  taskId: z.string().uuid(),
  userId: z.string().uuid(),
  assigned: z.boolean(),
});
export type ToggleAssignmentInput = z.input<typeof toggleAssignmentInput>;

export const copyAssignmentsInput = z.object({ date: isoDate() });

export const setSkillInput = z.object({
  userId: z.string().uuid(),
  taskId: z.string().uuid(),
  /** null = no sabe hacerla (se borra la fila). */
  level: z.enum(SKILL_LEVELS).nullable(),
});
export type SetSkillInput = z.input<typeof setSkillInput>;
