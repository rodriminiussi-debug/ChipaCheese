import { z } from "zod";
import { decimal, optIsoDate } from "@/lib/zod";

/** RF-29: nuevo precio de un producto en una lista (nueva fila con vigencia, se conserva el historial). */
export const setPriceInput = z.object({
  priceListId: z.string().uuid(),
  productId: z.string().uuid(),
  unitPrice: decimal({ min: 0.01, max: 100_000_000, message: "Ingresá el precio" }),
  /** Vacío = hoy. */
  validFrom: optIsoDate(),
});
export type SetPriceInput = z.input<typeof setPriceInput>;
export type SetPriceData = z.output<typeof setPriceInput>;

/** RF-29: margen objetivo de la lista (Regla 9), en % sobre el precio. */
export const targetMarginInput = z.object({
  priceListId: z.string().uuid(),
  targetMarginPct: decimal({ min: 0, max: 99, message: "Ingresá un margen entre 0 y 99" }),
});
export type TargetMarginInput = z.input<typeof targetMarginInput>;
export type TargetMarginData = z.output<typeof targetMarginInput>;

/** RF-29: aplica el precio sugerido a los productos de la lista que están bajo el margen objetivo. */
export const applySuggestedInput = z.object({
  priceListId: z.string().uuid(),
  /** Vacío = todos los que estén bajo el margen objetivo. */
  productIds: z.array(z.string().uuid()).nullish(),
  validFrom: optIsoDate(),
});
export type ApplySuggestedInput = z.input<typeof applySuggestedInput>;
export type ApplySuggestedData = z.output<typeof applySuggestedInput>;
