"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import { cashClosingInput, storeSaleInput } from "./schemas";
import { closeCash, createStoreSale } from "./service";

function revalidateStore() {
  revalidatePath("/local");
  revalidatePath("/stock/producto-terminado");
}

export const createStoreSaleAction = action(
  { permission: "store:write", schema: storeSaleInput },
  async (input, { tx, user }) => {
    const res = await createStoreSale(tx, user.id, input);
    revalidateStore();
    return { id: res.sale.id, total: res.total, units: res.units };
  },
);

export const closeCashAction = action(
  { permission: "store:write", schema: cashClosingInput },
  async (input, { tx, user }) => {
    const res = await closeCash(tx, user.id, input);
    revalidatePath("/local");
    return { id: res.closing.id, difference: res.difference };
  },
);
