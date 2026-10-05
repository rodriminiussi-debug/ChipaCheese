"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import { clampRecordedAt } from "@/lib/idempotency";
import {
  confirmCountInput,
  countIdInput,
  createCountInput,
  ingredientAdjustmentInput,
  ingredientLevelsInput,
  productTransferInput,
  saveCountPayload,
} from "./schemas";
import { adjustIngredientStock, transferProduct, updateIngredientLevels } from "./service";
import { confirmInventoryCount, createInventoryCount, saveCountItems, voidInventoryCount } from "./inventory";

function revalidateStock() {
  revalidatePath("/stock", "layout");
}

export const adjustIngredientStockAction = action(
  { permission: "stock:write", schema: ingredientAdjustmentInput },
  async (input, { tx, user }) => {
    const res = await adjustIngredientStock(tx, user.id, input);
    revalidateStock();
    return res;
  },
);

export const updateIngredientLevelsAction = action(
  { permission: "stock:write", schema: ingredientLevelsInput },
  async (input, { tx }) => {
    await updateIngredientLevels(tx, input);
    revalidateStock();
    return { ingredientId: input.ingredientId };
  },
);

export const transferProductAction = action(
  { permission: "stock:write", schema: productTransferInput },
  async (input, { tx, user }) => {
    const res = await transferProduct(tx, user.id, input);
    revalidateStock();
    return res;
  },
);

/** Crear un conteo: Stock (jefa) o el operario desde la tablet (`stock:count`). Confirmar sigue siendo `stock:write`. */
export const createInventoryCountAction = action(
  { permission: ["stock:write", "stock:count"], schema: createCountInput },
  async (input, { tx, user }) => {
    const res = await createInventoryCount(tx, user.id, input);
    revalidateStock();
    revalidatePath("/planta/inventario");
    return res;
  },
);

/** Guardar avance del conteo (encolable offline: "stock.inventoryCountSave"; idempotente por clientId). */
export const saveInventoryCountAction = action(
  { permission: ["stock:write", "stock:count"], schema: saveCountPayload },
  async ({ countId, items, clientId, recordedAt }, { tx, user }) => {
    const res = await saveCountItems(tx, user.id, countId, items, {
      clientId,
      recordedAt: clampRecordedAt(new Date(recordedAt)),
    });
    revalidatePath(`/stock/inventario/${countId}`);
    revalidatePath("/planta/inventario");
    return res;
  },
);

export const confirmInventoryCountAction = action(
  { permission: "stock:write", schema: confirmCountInput },
  async ({ countId, items }, { tx, user }) => {
    const res = await confirmInventoryCount(tx, user.id, countId, items);
    revalidateStock();
    return res;
  },
);

export const voidInventoryCountAction = action(
  { permission: "stock:write", schema: countIdInput },
  async ({ countId }, { tx }) => {
    await voidInventoryCount(tx, countId);
    revalidateStock();
    return { countId };
  },
);
