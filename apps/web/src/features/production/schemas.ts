import { z } from "zod";
import {
  clientIdField,
  decimal,
  int,
  isoDate,
  optDecimal,
  optText,
  optUuid,
  recordedAtField,
} from "@/lib/zod";
import { PLAN_SHAPES } from "@chipa/domain";

/** Esquemas compartidos cliente/servidor del módulo de producción (RF-18 a RF-22). */

const uuid = () => z.string().uuid();
const planShape = z.enum(PLAN_SHAPES);

// --- RF-18 Receta maestra ---------------------------------------------------------------------

export const recipeLineInput = z.object({
  ingredientId: uuid(),
  qtyPerKgStarch: decimal({ min: 0 }),
  minPerKgStarch: optDecimal({ min: 0 }).optional(),
  maxPerKgStarch: optDecimal({ min: 0 }).optional(),
  instructions: optText(),
});
export type RecipeLineInput = z.input<typeof recipeLineInput>;

export const recipeVersionInput = z
  .object({
    expectedYieldPerKgStarch: decimal({ min: 0.1, max: 10 }),
    deviationThresholdPct: decimal({ min: 0, max: 100 }),
    notes: z.string().trim().min(3, "Contá qué cambió en esta versión"),
    items: z.array(recipeLineInput).min(1, "La receta necesita al menos un insumo"),
    /** Activar apenas se guarda (la versión vigente pasa a archivada). */
    activate: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.items.forEach((it, i) => {
      if (seen.has(it.ingredientId)) {
        ctx.addIssue({ code: "custom", path: ["items", i, "ingredientId"], message: "Insumo repetido" });
      }
      seen.add(it.ingredientId);
      if (it.minPerKgStarch != null && it.minPerKgStarch > it.qtyPerKgStarch) {
        ctx.addIssue({
          code: "custom",
          path: ["items", i, "minPerKgStarch"],
          message: "El mínimo no puede superar la cantidad",
        });
      }
      if (it.maxPerKgStarch != null && it.maxPerKgStarch < it.qtyPerKgStarch) {
        ctx.addIssue({
          code: "custom",
          path: ["items", i, "maxPerKgStarch"],
          message: "El máximo no puede ser menor que la cantidad",
        });
      }
    });
  });
export type RecipeVersionInput = z.input<typeof recipeVersionInput>;
export type RecipeVersionData = z.output<typeof recipeVersionInput>;

export const activateRecipeInput = z.object({ id: uuid() });

// --- RF-19 Plan --------------------------------------------------------------------------------

export const savePlanInput = z.object({
  date: isoDate(),
  items: z.array(z.object({ shape: planShape, kg: decimal({ min: 0, max: 2000 }) })).min(1),
  notes: optText(),
});
export type SavePlanInput = z.input<typeof savePlanInput>;
export type SavePlanData = z.output<typeof savePlanInput>;

export const confirmPlanInput = z.object({ date: isoDate() });

// --- RF-20 Producción ----------------------------------------------------------------------------

export const createRunInput = z.object({
  date: isoDate(),
  shift: z.enum(["morning", "afternoon"]).default("morning"),
  /** Vacío = receta activa. */
  recipeId: optUuid(),
  starchKg: decimal({ min: 1, max: 300 }).default(75),
  batches: int({ min: 1, max: 6 }).default(2),
  responsibleId: z.string().uuid("Elegí un responsable"),
  supervisorId: optUuid(),
  workerIds: z.array(uuid()).default([]),
  notes: optText(),
});
export type CreateRunInput = z.input<typeof createRunInput>;
export type CreateRunData = z.output<typeof createRunInput>;

export const consumptionLineInput = z.object({
  ingredientId: uuid(),
  rawLotId: optUuid(),
  qty: decimal({ min: 0 }),
});
export const recordConsumptionsInput = z.object({
  runId: uuid(),
  lines: z.array(consumptionLineInput).min(1),
});
export type RecordConsumptionsInput = z.input<typeof recordConsumptionsInput>;

export const recordWeighingsInput = z.object({
  runId: uuid(),
  items: z.array(z.object({ shape: planShape, kg: decimal({ min: 0, max: 1000 }) })).min(1),
});
export type RecordWeighingsInput = z.input<typeof recordWeighingsInput>;

export const deleteWeighingInput = z.object({ id: uuid() });

export const setRunStatusInput = z
  .object({
    runId: uuid(),
    status: z.enum(["in_progress", "freezing", "packed", "closed", "cancelled"]),
    freezerCodes: z.array(z.enum(["F1", "F2"])).default([]),
    /** HH:mm de entrada al abatidor; vacío = ahora. */
    frozenTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida")
      .nullish()
      .transform((v) => v ?? null),
  })
  .superRefine((v, ctx) => {
    if (v.status === "freezing" && v.freezerCodes.length === 0) {
      ctx.addIssue({ code: "custom", path: ["freezerCodes"], message: "Elegí F1, F2 o ambos" });
    }
  });
export type SetRunStatusInput = z.input<typeof setRunStatusInput>;

export const recordPackingInput = z.object({
  runId: uuid(),
  items: z
    .array(z.object({ productId: uuid(), units: int({ min: 1, max: 5000 }), locationId: uuid() }))
    .min(1),
});
export type RecordPackingInput = z.input<typeof recordPackingInput>;

/**
 * Carga sin señal (RF-20 en tablet/celular): los envíos encolables llevan `clientId` (uuid de la tablet,
 * idempotencia al reenviar desde la cola) y `recordedAt` (momento real de la carga). Ver `src/lib/offline-queue.ts`.
 */
const offlineStamp = { clientId: clientIdField(), recordedAt: recordedAtField() };
export const recordConsumptionsPayload = recordConsumptionsInput.extend(offlineStamp);
export type RecordConsumptionsPayload = z.input<typeof recordConsumptionsPayload>;
export const recordWeighingsPayload = recordWeighingsInput.extend(offlineStamp);
export type RecordWeighingsPayload = z.input<typeof recordWeighingsPayload>;
export const recordPackingPayload = recordPackingInput.extend(offlineStamp);
export type RecordPackingPayload = z.input<typeof recordPackingPayload>;
