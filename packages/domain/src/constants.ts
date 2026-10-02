/**
 * Constantes de negocio de Chipa Cheese (Pacon SRL).
 * Fuente: docs/relevamiento.md, "Capacidad productiva" y "Reglas de negocio y cálculos".
 */

/** Peso neto de una bolsa estándar de producto terminado, en kg (Regla 3: bolsas equivalentes = kg ÷ 0,5). */
export const BAG_KG = 0.5;

/** Vida útil declarada del producto congelado, en meses (Regla 4: vencimiento = elaboración + 6 meses). */
export const SHELF_LIFE_MONTHS = 6;

/** Capacidad diaria máxima, en kg de producto: límite del abatidor F1/F2 (Regla 1). */
export const DAILY_CAPACITY_KG = 150;

/** Mínimo de producto por tanda, en kg (Regla 1). */
export const MIN_BATCH_KG = 75;

/** Una receta = 75 kg de fécula, que rinden ~150 kg de producto (Regla 1). */
export const STARCH_KG_PER_RECIPE = 75;

/** Alícuotas de IVA admitidas en Argentina, en porcentaje (Regla 11). */
export const VAT_RATES = [0, 10.5, 21, 27] as const;
