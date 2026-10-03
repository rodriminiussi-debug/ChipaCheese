"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import { applySuggestedInput, setPriceInput, targetMarginInput } from "./schemas";
import { applySuggestedPrices, setPrice, updateTargetMargin } from "./service";

export const setPriceAction = action(
  { permission: "prices:write", schema: setPriceInput },
  async (input, { tx }) => {
    const row = await setPrice(tx, input);
    revalidatePath("/precios");
    revalidatePath("/pedidos/nuevo");
    return { id: row.id };
  },
);

export const updateTargetMarginAction = action(
  { permission: "prices:write", schema: targetMarginInput },
  async (input, { tx }) => {
    await updateTargetMargin(tx, input);
    revalidatePath("/precios");
    return { priceListId: input.priceListId };
  },
);

export const applySuggestedPricesAction = action(
  { permission: "prices:write", schema: applySuggestedInput },
  async (input, { tx }) => {
    const res = await applySuggestedPrices(tx, input);
    revalidatePath("/precios");
    revalidatePath("/pedidos/nuevo");
    return res;
  },
);
