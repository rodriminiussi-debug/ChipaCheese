import { z } from "zod";
import { optText, optUuid } from "@/lib/zod";

/** Cantidad positiva desde un input numérico (acepta number o string "12.5"). */
const positiveQty = (message = "Ingresá una cantidad mayor a 0") =>
  z.coerce.number({ message }).positive(message).max(1_000_000, "Cantidad demasiado grande");

/** Cantidad >= 0 desde un input numérico. */
const nonNegativeQty = (message = "Ingresá una cantidad válida") =>
  z.coerce.number({ message }).min(0, "No puede ser negativa").max(1_000_000, "Cantidad demasiado grande");

// --- RF-13: ajustes manuales de materia prima ------------------------------------------------

/** Tipo de ajuste manual. Merma y descarte salen (waste); la corrección puede sumar o restar (adjustment). */
export const ADJUSTMENT_KINDS = ["shrinkage", "discard", "correction_in", "correction_out"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const ingredientAdjustmentInput = z.object({
  ingredientId: z.string().uuid(),
  /** Posición (lote × ubicación) sobre la que se ajusta. Sin lote → null. */
  rawLotId: optUuid(),
  locationId: z.string().uuid("Elegí la ubicación"),
  kind: z.enum(ADJUSTMENT_KINDS),
  qty: positiveQty(),
  reason: z.string().trim().min(3, "Indicá el motivo (obligatorio)").max(500),
});
export type IngredientAdjustmentInput = z.input<typeof ingredientAdjustmentInput>;
export type IngredientAdjustmentData = z.output<typeof ingredientAdjustmentInput>;

// --- RF-14: stock mínimo y de seguridad ------------------------------------------------------

export const ingredientLevelsInput = z.object({
  ingredientId: z.string().uuid(),
  minStock: nonNegativeQty(),
  safetyStock: nonNegativeQty(),
});
export type IngredientLevelsInput = z.input<typeof ingredientLevelsInput>;
export type IngredientLevelsData = z.output<typeof ingredientLevelsInput>;

// --- RF-16: transferencia de producto terminado ----------------------------------------------

export const productTransferInput = z
  .object({
    productId: z.string().uuid("Elegí el producto"),
    fromLocationId: z.string().uuid("Elegí el origen"),
    toLocationId: z.string().uuid("Elegí el destino"),
    units: z.coerce
      .number({ message: "Ingresá las unidades" })
      .int("Deben ser unidades enteras")
      .positive("Ingresá una cantidad mayor a 0")
      .max(1_000_000),
    /** Lote puntual; vacío = FEFO automático (vence primero, sale primero). */
    finishedLotId: optUuid(),
    note: optText(),
  })
  .refine((v) => v.fromLocationId !== v.toLocationId, {
    message: "El origen y el destino deben ser distintos",
    path: ["toLocationId"],
  });
export type ProductTransferInput = z.input<typeof productTransferInput>;
export type ProductTransferData = z.output<typeof productTransferInput>;

// --- RF-15: inventario físico ----------------------------------------------------------------

export const createCountInput = z.object({
  itemKind: z.enum(["ingredient", "product"]),
  notes: optText(),
});
export type CreateCountInput = z.input<typeof createCountInput>;

export const saveCountInput = z.object({
  countId: z.string().uuid(),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        /** null = todavía no contado. */
        countedQty: z
          .union([z.literal(""), z.null(), z.undefined(), nonNegativeQty()])
          .transform((v) => (v === "" || v == null ? null : v)),
      }),
    )
    .max(2000),
});
export type SaveCountInput = z.input<typeof saveCountInput>;

export const confirmCountInput = saveCountInput;
export const countIdInput = z.object({ countId: z.string().uuid() });

// --- Filtros del libro mayor (se leen de la URL) ---------------------------------------------

export const MOVEMENT_PAGE_SIZE = 50;
