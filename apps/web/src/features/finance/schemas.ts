import { z } from "zod";
import { decimal, optText } from "@/lib/zod";
import { EXPENSE_CATEGORIES } from "./labels";

/** Mes "AAAA-MM". Idempotente. */
export const monthString = () => z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes inválido (usá AAAA-MM)");

export const monthInput = z.object({ month: monthString() });

/** RF-42: alta de un gasto fijo del mes. */
export const fixedExpenseInput = z.object({
  month: monthString(),
  concept: z.string().trim().min(2, "Ingresá el concepto"),
  category: z.enum(EXPENSE_CATEGORIES, { message: "Elegí la categoría" }),
  amount: decimal({ min: 0, message: "Ingresá el importe" }),
  notes: optText(),
});
export type FixedExpenseInput = z.input<typeof fixedExpenseInput>;
export type FixedExpenseData = z.output<typeof fixedExpenseInput>;

export const updateFixedExpenseInput = fixedExpenseInput.omit({ month: true }).extend({
  id: z.string().uuid(),
});
export type UpdateFixedExpenseInput = z.input<typeof updateFixedExpenseInput>;
export type UpdateFixedExpenseData = z.output<typeof updateFixedExpenseInput>;

export const deleteFixedExpenseInput = z.object({ id: z.string().uuid() });

/** "Copiar del mes anterior" al mes indicado. */
export const copyExpensesInput = z.object({ month: monthString() });

/** Retiros de los socios por mes (en total). */
export const withdrawalsInput = z.object({
  amount: decimal({ min: 0, message: "Ingresá el monto mensual" }),
});
export type WithdrawalsInput = z.input<typeof withdrawalsInput>;
export type WithdrawalsData = z.output<typeof withdrawalsInput>;
