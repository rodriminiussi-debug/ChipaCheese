import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { day, id, money, timestamps } from "./_columns";

/** Gastos fijos y servicios por mes (RF-42). `month` = primer día del mes. */
export const fixedExpenses = pgTable(
  "fixed_expenses",
  {
    id: id(),
    month: day().notNull(),
    concept: text().notNull(),
    /** rent | services | payroll | taxes | vehicle | professional | insurance | other */
    category: text().notNull(),
    amount: money().notNull(),
    notes: text(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("fixed_expenses_uq").on(t.month, t.concept),
    index("fixed_expenses_month_idx").on(t.month),
  ],
);
