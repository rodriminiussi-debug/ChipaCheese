"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import {
  copyExpensesInput,
  deleteFixedExpenseInput,
  fixedExpenseInput,
  updateFixedExpenseInput,
  withdrawalsInput,
} from "./schemas";
import {
  copyFixedExpensesFromPreviousMonth,
  createFixedExpense,
  deleteFixedExpense,
  setPartnerWithdrawals,
  updateFixedExpense,
} from "./service";

function revalidateFinance() {
  revalidatePath("/costos/gastos");
  revalidatePath("/costos/resultado");
  revalidatePath("/tablero");
}

export const createFixedExpenseAction = action(
  { permission: "finance:write", schema: fixedExpenseInput },
  async (input, { tx }) => {
    const row = await createFixedExpense(tx, input);
    revalidateFinance();
    return { id: row.id };
  },
);

export const updateFixedExpenseAction = action(
  { permission: "finance:write", schema: updateFixedExpenseInput },
  async (input, { tx }) => {
    await updateFixedExpense(tx, input);
    revalidateFinance();
    return { id: input.id };
  },
);

export const deleteFixedExpenseAction = action(
  { permission: "finance:write", schema: deleteFixedExpenseInput },
  async ({ id }, { tx }) => {
    await deleteFixedExpense(tx, id);
    revalidateFinance();
    return { id };
  },
);

export const copyFixedExpensesAction = action(
  { permission: "finance:write", schema: copyExpensesInput },
  async ({ month }, { tx }) => {
    const res = await copyFixedExpensesFromPreviousMonth(tx, month);
    revalidateFinance();
    return res;
  },
);

export const setWithdrawalsAction = action(
  { permission: "finance:write", schema: withdrawalsInput },
  async ({ amount }, { tx }) => {
    const res = await setPartnerWithdrawals(tx, amount);
    revalidateFinance();
    return res;
  },
);
