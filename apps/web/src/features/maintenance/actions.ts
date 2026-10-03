"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import {
  closeCorrectiveInput,
  correctiveInput,
  planInput,
  registerPreventiveInput,
  updateCorrectiveInput,
  updatePlanInput,
} from "./schemas";
import {
  closeCorrective,
  createCorrective,
  createPlan,
  registerPreventive,
  updateCorrective,
  updatePlan,
} from "./service";

function revalidateMaintenance(equipmentId?: string) {
  revalidatePath("/mantenimiento");
  if (equipmentId) revalidatePath(`/mantenimiento/equipos/${equipmentId}`);
}

export const createPlanAction = action(
  { permission: "maintenance:write", schema: planInput },
  async (input, { tx }) => {
    const row = await createPlan(tx, input);
    revalidateMaintenance(row.equipmentId);
    return { id: row.id };
  },
);

export const updatePlanAction = action(
  { permission: "maintenance:write", schema: updatePlanInput },
  async ({ id, ...input }, { tx }) => {
    const row = await updatePlan(tx, id, input);
    revalidateMaintenance(row.equipmentId);
    return { id };
  },
);

/** Registra un preventivo hecho (crea la orden y actualiza el último hecho del plan). */
export const registerPreventiveAction = action(
  { permission: "maintenance:write", schema: registerPreventiveInput },
  async (input, { tx, user }) => {
    const order = await registerPreventive(tx, user.id, input);
    revalidateMaintenance(order.equipmentId);
    return { id: order.id };
  },
);

export const createCorrectiveAction = action(
  { permission: "maintenance:write", schema: correctiveInput },
  async (input, { tx, user }) => {
    const row = await createCorrective(tx, user.id, input);
    revalidateMaintenance(row.equipmentId);
    return { id: row.id };
  },
);

export const updateCorrectiveAction = action(
  { permission: "maintenance:write", schema: updateCorrectiveInput },
  async ({ id, ...input }, { tx }) => {
    const row = await updateCorrective(tx, id, input);
    revalidateMaintenance(row.equipmentId);
    return { id };
  },
);

export const closeCorrectiveAction = action(
  { permission: "maintenance:write", schema: closeCorrectiveInput },
  async (input, { tx }) => {
    const row = await closeCorrective(tx, input);
    revalidateMaintenance(row.equipmentId);
    return { id: row.id };
  },
);
