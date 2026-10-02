import { z } from "zod";
import { parseDecimalAR } from "@chipa/domain";

/**
 * Helpers zod del proyecto. Los esquemas deben ser IDEMPOTENTES: la salida validada en el cliente
 * se vuelve a validar en el servidor, así que cada campo debe aceptar su propia salida (p. ej. null).
 */

/** Texto opcional: "" / undefined / null → null. */
export const optText = () =>
  z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null));

/** UUID opcional (selects con "ninguno"). */
export const optUuid = () =>
  z
    .string()
    .uuid()
    .nullish()
    .transform((v) => v ?? null);

/** Número desde input (acepta "1.234,5" o "1234.5" o number). */
export const decimal = (opts: { min?: number; max?: number; message?: string } = {}) =>
  z
    .union([z.number(), z.string()])
    .transform((v, ctx) => {
      const n = typeof v === "number" ? v : parseDecimalAR(v);
      if (n == null || Number.isNaN(n)) {
        ctx.addIssue({ code: "custom", message: opts.message ?? "Ingresá un número" });
        return z.NEVER;
      }
      return n;
    })
    .pipe(
      z
        .number()
        .min(opts.min ?? -Infinity, `Mínimo ${opts.min}`)
        .max(opts.max ?? Infinity, `Máximo ${opts.max}`),
    );

/** Decimal opcional: vacío → null. */
export const optDecimal = (opts: { min?: number; max?: number } = {}) =>
  z
    .union([z.literal(""), decimal(opts)])
    .nullish()
    .transform((v) => (v === "" || v == null ? null : v));

/** Entero desde input. */
export const int = (opts: { min?: number; max?: number } = {}) =>
  z.coerce
    .number({ message: "Ingresá un número entero" })
    .int("Debe ser entero")
    .min(opts.min ?? -Infinity, `Mínimo ${opts.min}`)
    .max(opts.max ?? Infinity, `Máximo ${opts.max}`);

/** Fecha de negocio YYYY-MM-DD. */
export const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
export const optIsoDate = () =>
  z
    .union([z.literal(""), isoDate()])
    .nullish()
    .transform((v) => (v ? v : null));
