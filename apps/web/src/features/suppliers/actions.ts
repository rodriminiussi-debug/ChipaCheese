"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import { supplierIngredientsInput, supplierInput, updateSupplierInput } from "./schemas";
import { createSupplier, setSupplierIngredients, updateSupplier } from "./service";

export const createSupplierAction = action(
  { permission: "suppliers:write", schema: supplierInput },
  async (input, { tx }) => {
    const row = await createSupplier(tx, input);
    revalidatePath("/proveedores");
    return { id: row.id };
  },
);

export const updateSupplierAction = action(
  { permission: "suppliers:write", schema: updateSupplierInput },
  async ({ id, ...input }, { tx }) => {
    await updateSupplier(tx, id, input);
    revalidatePath("/proveedores");
    revalidatePath(`/proveedores/${id}`);
    return { id };
  },
);

export const setSupplierIngredientsAction = action(
  { permission: "suppliers:write", schema: supplierIngredientsInput },
  async ({ supplierId, items }, { tx }) => {
    const count = await setSupplierIngredients(tx, supplierId, items);
    revalidatePath(`/proveedores/${supplierId}`);
    return { count };
  },
);
