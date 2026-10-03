import { z } from "zod";
import { isValidCuit } from "@chipa/domain";
import { int, optText } from "@/lib/zod";

/** Esquema compartido cliente/servidor (RF-07). */
export const supplierInput = z.object({
  legalName: z.string().trim().min(2, "Ingresá la razón social"),
  tradeName: optText(),
  cuit: optText()
    .transform((v) => (v ? v.replace(/\D/g, "") : null))
    .refine((v) => v == null || isValidCuit(v), "CUIT inválido"),
  leadTimeDays: int({ min: 0, max: 90 }).default(1),
  paymentTermsDays: int({ min: 0, max: 180 }).default(0),
  paymentNotes: optText(),
  whatsapp: optText(),
  notes: optText(),
  active: z.boolean().default(true),
});
export type SupplierInput = z.input<typeof supplierInput>;
export type SupplierData = z.output<typeof supplierInput>;

export const updateSupplierInput = supplierInput.extend({ id: z.string().uuid() });

/** Insumos que vende el proveedor (reemplaza el conjunto completo). */
export const supplierIngredientsInput = z.object({
  supplierId: z.string().uuid(),
  items: z.array(z.object({ ingredientId: z.string().uuid(), supplierCode: optText() })),
});
export type SupplierIngredientsInput = z.input<typeof supplierIngredientsInput>;
