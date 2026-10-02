"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import {
  confirmCountInput,
  countIdInput,
  createCountInput,
  ingredientAdjustmentInput,
  ingredientLevelsInput,
  productTransferInput,
  saveCountInput,
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

export const createInventoryCountAction = action(
  { permission: "stock:write", schema: createCountInput },
  async (input, { tx, user }) => {
    const res = await createInventoryCount(tx, user.id, input);
    revalidateStock();
    return res;
  },
);

export const saveInventoryCountAction = action(
  { permission: "stock:write", schema: saveCountInput },
  async ({ countId, items }, { tx, user }) => {
    const res = await saveCountItems(tx, user.id, countId, items);
    revalidatePath(`/stock/inventario/${countId}`);
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
