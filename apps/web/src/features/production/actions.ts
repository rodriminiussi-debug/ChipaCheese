"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import { getSetting } from "@/server/settings";
import { UserError } from "@/server/errors";
import { can } from "@/lib/rbac";
import { todayAR } from "@/lib/dates";
import {
  activateRecipeInput,
  confirmPlanInput,
  createRunInput,
  deleteWeighingInput,
  recipeVersionInput,
  recordConsumptionsInput,
  recordPackingInput,
  recordWeighingsInput,
  savePlanInput,
  setRunStatusInput,
} from "./schemas";
import {
  activateRecipe,
  confirmPlan,
  createRecipeVersion,
  createRun,
  deleteWeighing,
  recordConsumptions,
  recordPacking,
  recordWeighings,
  savePlan,
  setRunStatus,
} from "./service";

/** Quien arma el plan y las producciones (jefa) o carga desde la tablet (operario). */
const WRITE_OR_RECORD = ["production:write", "production:record"] as const;

function revalidateProduction(runId?: string) {
  revalidatePath("/produccion");
  revalidatePath("/planta/produccion");
  revalidatePath("/planta/envasado");
  if (runId) revalidatePath(`/produccion/${runId}`);
}

// --- RF-18 ------------------------------------------------------------------------------------

export const createRecipeVersionAction = action(
  { permission: "recipes:write", schema: recipeVersionInput },
  async (input, { tx }) => {
    const row = await createRecipeVersion(tx, input, todayAR());
    revalidatePath("/produccion/receta");
    return { id: row.id, version: row.version };
  },
);

export const activateRecipeAction = action(
  { permission: "recipes:write", schema: activateRecipeInput },
  async ({ id }, { tx }) => {
    const row = await activateRecipe(tx, id, todayAR());
    revalidatePath("/produccion/receta");
    return { id: row.id, version: row.version };
  },
);

// --- RF-19 ------------------------------------------------------------------------------------

export const savePlanAction = action(
  { permission: "production:write", schema: savePlanInput },
  async (input, { tx }) => {
    const plan = await savePlan(tx, input);
    revalidatePath("/produccion");
    return { id: plan.id, totalKg: plan.totalKg };
  },
);

export const confirmPlanAction = action(
  { permission: "production:write", schema: confirmPlanInput },
  async ({ date }, { tx }) => {
    const [capacityKg, minBatchKg] = await Promise.all([
      getSetting("production.daily_capacity_kg", 150),
      getSetting("production.min_batch_kg", 75),
    ]);
    const plan = await confirmPlan(tx, date, { capacityKg, minBatchKg });
    revalidatePath("/produccion");
    return { id: plan.id };
  },
);

// --- RF-20 ------------------------------------------------------------------------------------

export const createRunAction = action(
  { permission: "production:write", schema: createRunInput },
  async (input, { tx }) => {
    const run = await createRun(tx, input, todayAR());
    revalidateProduction();
    return { id: run.id, runNumber: run.runNumber, lateEntry: run.lateEntry };
  },
);

export const recordConsumptionsAction = action(
  { permission: [...WRITE_OR_RECORD], schema: recordConsumptionsInput },
  async (input, { tx, user }) => {
    const res = await recordConsumptions(tx, user.id, input);
    revalidateProduction(input.runId);
    return { outOfRange: res.outOfRange, lines: res.rows.length };
  },
);

export const setRunStatusAction = action(
  { permission: [...WRITE_OR_RECORD], schema: setRunStatusInput },
  async (input, { tx, user }) => {
    // Cerrar o cancelar es decisión de la jefa; el operario solo avanza la elaboración.
    if (["closed", "cancelled"].includes(input.status) && !can(user.role, "production:write")) {
      throw new UserError("Solo la jefa de producción puede cerrar o cancelar una producción.");
    }
    const run = await setRunStatus(tx, input);
    revalidateProduction(run.id);
    return { id: run.id, status: run.status };
  },
);

// --- RF-21 ------------------------------------------------------------------------------------

export const recordWeighingsAction = action(
  { permission: [...WRITE_OR_RECORD], schema: recordWeighingsInput },
  async (input, { tx, user }) => {
    const rows = await recordWeighings(tx, user.id, input);
    revalidateProduction(input.runId);
    return { count: rows.length };
  },
);

export const deleteWeighingAction = action(
  { permission: [...WRITE_OR_RECORD], schema: deleteWeighingInput },
  async ({ id }, { tx }) => {
    await deleteWeighing(tx, id);
    revalidateProduction();
    return { id };
  },
);

// --- RF-22 ------------------------------------------------------------------------------------

export const recordPackingAction = action(
  { permission: [...WRITE_OR_RECORD], schema: recordPackingInput },
  async (input, { tx, user }) => {
    const { lot, packings } = await recordPacking(tx, user.id, input);
    revalidateProduction(input.runId);
    revalidatePath(`/produccion/lotes/${lot.code}`);
    return { lotCode: lot.code, units: packings.reduce((a, p) => a + p.units, 0) };
  },
);
