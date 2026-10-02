"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import { customerInput, updateCustomerInput } from "./schemas";
import { createCustomer, updateCustomer } from "./service";

export const createCustomerAction = action(
  { permission: "customers:write", schema: customerInput },
  async (input, { tx }) => {
    const row = await createCustomer(tx, input);
    revalidatePath("/clientes");
    return { id: row.id };
  },
);

export const updateCustomerAction = action(
  { permission: "customers:write", schema: updateCustomerInput },
  async ({ id, ...input }, { tx }) => {
    await updateCustomer(tx, id, input);
    revalidatePath("/clientes");
    revalidatePath(`/clientes/${id}`);
    return { id };
  },
);
