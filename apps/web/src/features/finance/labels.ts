/** Categorías de gastos fijos (RF-42). `fixed_expenses.category` es texto libre en la base: estas son las que usa la UI. */
export const EXPENSE_CATEGORIES = [
  "rent",
  "services",
  "payroll",
  "taxes",
  "vehicle",
  "fuel",
  "professional",
  "insurance",
  "depreciation",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY: Record<string, string> = {
  rent: "Alquiler",
  services: "Servicios",
  payroll: "Sueldos",
  taxes: "Impuestos y tasas",
  vehicle: "Vehículo",
  fuel: "Combustible",
  professional: "Profesionales",
  insurance: "Seguros",
  depreciation: "Amortizaciones",
  other: "Otros",
};

/**
 * Categorías que el Excel de abril no tenía (error 9 del relevamiento): si no hay nada cargado en el mes,
 * la pantalla avisa que el resultado puede estar sobrestimado.
 */
export const EXCEL_MISSING_CATEGORIES: { category: ExpenseCategory; hint: string }[] = [
  { category: "vehicle", hint: "patente, seguro y mantenimiento del vehículo de reparto" },
  {
    category: "fuel",
    hint: "combustible que no esté ya en el costo de reparto por ruta (para no contarlo dos veces)",
  },
  { category: "payroll", hint: "sueldos del local y de la parte administrativa" },
  { category: "taxes", hint: "impuestos (IIBB, ganancias, tasas municipales)" },
  { category: "depreciation", hint: "amortización de máquinas (Biscomatic, abatidor, cámaras)" },
];

/** Clave de app_settings con lo que los socios retiran por mes (en total). */
export const SETTING_WITHDRAWALS = "finance.partner_withdrawals_monthly";
/** ~$9M entre los tres socios (relevamiento, "Estimación de resultado mensual"). */
export const DEFAULT_WITHDRAWALS = 9_000_000;
