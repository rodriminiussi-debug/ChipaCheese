import { z } from "zod";
import { isValidCuit } from "@chipa/domain";
import { int, optText, optUuid } from "@/lib/zod";

/** Esquema compartido cliente/servidor (RF-01). */
export const customerInput = z.object({
  legalName: z.string().trim().min(2, "Ingresá la razón social"),
  tradeName: optText(),
  cuit: optText()
    .transform((v) => (v ? v.replace(/\D/g, "") : null))
    .refine((v) => v == null || isValidCuit(v), "CUIT inválido"),
  channel: z.enum(["supermarket", "reseller", "store", "distributor", "other"]),
  priceListId: optUuid(),
  zoneId: optUuid(),
  deliveryWeekdays: z.array(z.coerce.number().int().min(1).max(7)).default([]),
  paymentTermsDays: int({ min: 0, max: 180 }).default(0),
  paymentNotes: optText(),
  whatsapp: optText(),
  address: optText(),
  notes: optText(),
  active: z.boolean().default(true),
});
export type CustomerInput = z.input<typeof customerInput>;
export type CustomerData = z.output<typeof customerInput>;

export const updateCustomerInput = customerInput.extend({ id: z.string().uuid() });
