import { z } from "zod";
import { decimal, int, isoDate, optText } from "@/lib/zod";

/** Medios de pago del local (relevamiento: efectivo y transferencia). */
export const STORE_METHODS = ["cash", "transfer"] as const;

/** RF-33: una venta del local = ítems + medio de pago. El precio sale de la lista del canal local. */
export const storeSaleInput = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qtyUnits: int({ min: 1, max: 9999 }),
      }),
    )
    .min(1, "Agregá al menos un producto"),
  method: z.enum(STORE_METHODS),
});
export type StoreSaleInput = z.input<typeof storeSaleInput>;
export type StoreSaleData = z.output<typeof storeSaleInput>;

/** RF-33: cierre de caja del día: lo contado en efectivo. */
export const cashClosingInput = z.object({
  countedCash: decimal({ min: 0, message: "Ingresá el efectivo contado" }),
  notes: optText(),
  /** Vacío = hoy. */
  date: z
    .union([z.literal(""), isoDate()])
    .nullish()
    .transform((v) => (v ? v : null)),
});
export type CashClosingInput = z.input<typeof cashClosingInput>;
export type CashClosingData = z.output<typeof cashClosingInput>;
