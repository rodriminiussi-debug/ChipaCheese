import { z } from "zod";
import { decimal, int, isoDate, optDecimal, optText, optUuid } from "@/lib/zod";

/** Medios de pago del local: efectivo, transferencia, tarjeta (débito o crédito) y QR / billetera virtual. */
export const STORE_METHODS = ["cash", "transfer", "card", "qr"] as const;
export type StoreMethod = (typeof STORE_METHODS)[number];

/**
 * RF-33: una venta del local = ítems + pagos. El precio sale de la lista del canal local (o de la lista del
 * cliente mayorista si se indica uno). Un solo pago puede omitir el monto (es el total); con pago dividido
 * (dos medios) los montos deben sumar el total.
 */
export const storeSaleInput = z
  .object({
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          qtyUnits: int({ min: 1, max: 9999 }),
        }),
      )
      .min(1, "Agregá al menos un producto"),
    payments: z
      .array(z.object({ method: z.enum(STORE_METHODS), amount: optDecimal({ min: 0.01 }) }))
      .min(1, "Elegí el medio de pago")
      .max(2, "Se puede dividir el pago en hasta dos medios"),
    /** Venta mayorista en el local: cliente opcional. */
    customerId: optUuid(),
  })
  .refine((v) => v.payments.length === 1 || v.payments.every((p) => p.amount != null), {
    message: "Indicá cuánto se paga con cada medio",
    path: ["payments"],
  })
  .refine((v) => v.payments.length < 2 || v.payments[0]!.method !== v.payments[1]!.method, {
    message: "Elegí dos medios distintos",
    path: ["payments"],
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

/** Anular una venta cargada por error: el motivo es obligatorio. */
export const voidSaleInput = z.object({
  saleId: z.string().uuid(),
  reason: z.string().trim().min(3, "Contá el motivo de la anulación").max(300),
});
export type VoidSaleInput = z.input<typeof voidSaleInput>;
export type VoidSaleData = z.output<typeof voidSaleInput>;

/** Ingreso de mercadería de reventa que trae el proveedor al local (gaseosas, aguas…). */
export const resaleReceiptInput = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: int({ min: 1, max: 9999 }),
        unitCostNet: optDecimal({ min: 0 }),
      }),
    )
    .min(1, "Agregá al menos un producto"),
  supplierId: optUuid(),
});
export type ResaleReceiptInput = z.input<typeof resaleReceiptInput>;
export type ResaleReceiptData = z.output<typeof resaleReceiptInput>;

/** Pedido de reposición del local a la planta. */
export const replenishmentRequestInput = z.object({
  items: z
    .array(z.object({ productId: z.string().uuid(), qty: int({ min: 1, max: 9999 }) }))
    .min(1, "Elegí al menos un producto a reponer"),
  neededBy: z
    .union([z.literal(""), isoDate()])
    .nullish()
    .transform((v) => (v ? v : null)),
  notes: optText(),
});
export type ReplenishmentRequestInput = z.input<typeof replenishmentRequestInput>;
export type ReplenishmentRequestData = z.output<typeof replenishmentRequestInput>;

/** La planta envía el pedido: cantidades por ítem (por defecto lo pedido). */
export const replenishmentSendInput = z.object({
  id: z.string().uuid(),
  items: z
    .array(z.object({ itemId: z.string().uuid(), qty: int({ min: 0, max: 9999 }) }))
    .min(1)
    .optional(),
});
export type ReplenishmentSendInput = z.input<typeof replenishmentSendInput>;
export type ReplenishmentSendData = z.output<typeof replenishmentSendInput>;

export const replenishmentIdInput = z.object({ id: z.string().uuid() });
export type ReplenishmentIdData = z.output<typeof replenishmentIdInput>;
