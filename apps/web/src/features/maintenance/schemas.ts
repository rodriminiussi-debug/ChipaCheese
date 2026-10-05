import { z } from "zod";
import { decimal, int, isoDate, optText, optUuid } from "@/lib/zod";

/** Esquemas compartidos cliente/servidor del mantenimiento (RF-37). */

const optMoney = () =>
  z
    .union([z.literal(""), decimal({ min: 0, max: 100_000_000 })])
    .nullish()
    .transform((v) => (v === "" || v == null ? null : v));

const optMinutes = () =>
  z
    .union([z.literal(""), int({ min: 0, max: 100_000 })])
    .nullish()
    .transform((v) => (v === "" || v == null ? null : v));

// --- Planes preventivos -------------------------------------------------------------------------------
export const planInput = z.object({
  equipmentId: z.string().uuid("Elegí el equipo"),
  task: z.string().trim().min(3, "Indicá la tarea"),
  frequencyDays: int({ min: 1, max: 730 }),
  /** Alta del plan: desde acá se cuenta el primer vencimiento si nunca se hizo. */
  startDate: isoDate(),
  active: z.boolean().default(true),
});
export type PlanInput = z.input<typeof planInput>;
export type PlanData = z.output<typeof planInput>;
export const updatePlanInput = planInput.extend({ id: z.string().uuid() });

/** Registrar un preventivo hecho: crea una orden `done` y actualiza `lastDoneAt` del plan. */
export const registerPreventiveInput = z.object({
  planId: z.string().uuid(),
  date: isoDate(),
  supervisorId: optUuid(),
  spareParts: optText(),
  cost: optMoney(),
  notes: optText(),
});
export type RegisterPreventiveInput = z.input<typeof registerPreventiveInput>;
export type RegisterPreventiveData = z.output<typeof registerPreventiveInput>;

// --- Correctivos ----------------------------------------------------------------------------------------
export const correctiveInput = z.object({
  equipmentId: z.string().uuid("Elegí el equipo"),
  date: isoDate(),
  cause: z.string().trim().min(3, "Indicá la causa"),
  activity: z.string().trim().min(3, "Indicá la actividad"),
  spareParts: optText(),
  cost: optMoney(),
  downtimeMinutes: optMinutes(),
  responsibleId: optUuid(),
  supervisorId: optUuid(),
  /** Cargar directamente como cerrada (ya se resolvió). */
  closed: z.boolean().default(false),
});
export type CorrectiveInput = z.input<typeof correctiveInput>;
export type CorrectiveData = z.output<typeof correctiveInput>;
export const updateCorrectiveInput = correctiveInput.extend({ id: z.string().uuid() });

export const closeCorrectiveInput = z.object({
  id: z.string().uuid(),
  doneAt: isoDate(),
  activity: z.string().trim().min(3, "Indicá la actividad realizada"),
  spareParts: optText(),
  cost: optMoney(),
  downtimeMinutes: optMinutes(),
});
export type CloseCorrectiveInput = z.input<typeof closeCorrectiveInput>;
export type CloseCorrectiveData = z.output<typeof closeCorrectiveInput>;

// --- Aviso de falla (operario, chofer, local, jefa) ------------------------------------------------------

/** Avisar que un equipo (o el equipo de frío del vehículo) tiene una falla: crea una correctiva abierta. */
export const reportFaultInput = z.object({
  equipmentId: z.string().uuid("Elegí el equipo"),
  description: z.string().trim().min(3, "Contá qué pasa").max(500, "Máximo 500 caracteres"),
  /** ¿Está parado? Hay que contestarlo: no se asume. */
  stopped: z.boolean(),
});
export type ReportFaultInput = z.input<typeof reportFaultInput>;
export type ReportFaultData = z.output<typeof reportFaultInput>;
