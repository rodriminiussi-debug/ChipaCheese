import { z } from "zod";
import { normalizeInvoiceNumber } from "@chipa/domain";
import { decimal, isoDate, optDecimal, optIsoDate, optText, optUuid } from "@/lib/zod";

const uuid = z.string().uuid();
export const INVOICE_TYPES = ["A", "B", "C", "X", "NC_A", "NC_B", "NC_C"] as const;
export const UNITS = ["kg", "l", "unit"] as const;
export const PAYMENT_METHODS = ["cash", "transfer", "check", "card", "other"] as const;

// --- Facturas (RF-08) ---------------------------------------------------------------------

/** Subida de la foto/PDF: la Server Action recibe FormData con el campo `file`. */
export const uploadInvoiceInput = z.object({
  file: z
    .instanceof(File, { message: "Elegí una foto o un PDF" })
    .refine((f) => f.size > 0, "El archivo está vacío"),
});

export const invoiceItemInput = z.object({
  description: z.string().trim().min(1, "Ingresá la descripción"),
  /** Insumo al que se mapea la línea (null = no es un insumo, p. ej. un flete). */
  ingredientId: optUuid(),
  qty: decimal({ min: 0 }),
  unit: z
    .enum(UNITS)
    .nullish()
    .transform((v) => v ?? null),
  unitPriceNet: decimal({ min: 0 }),
  /** Alícuota que figura en la factura (Regla 11): 21, 10,5… */
  vatRate: decimal({ min: 0, max: 100 }),
  /** IVA de la línea según la factura. Vacío = neto × alícuota. */
  vatAmount: optDecimal({ min: 0 }),
});

export const invoiceInput = z.object({
  id: uuid,
  supplierId: optUuid(),
  invoiceType: z.enum(INVOICE_TYPES),
  pointOfSale: optText().transform((v) => normalizeInvoiceNumber(v, 4)),
  number: optText().transform((v) => normalizeInvoiceNumber(v, 8)),
  issueDate: optIsoDate(),
  dueDate: optIsoDate(),
  otherTaxes: optDecimal({ min: 0 }).transform((v) => v ?? 0),
  /** Totales tal como figuran en la factura (si se dejan vacíos se usan los calculados). */
  declaredNet: optDecimal({ min: 0 }),
  declaredVat: optDecimal({ min: 0 }),
  declaredTotal: optDecimal({ min: 0 }),
  notes: optText(),
  items: z.array(invoiceItemInput),
});
export type InvoiceFormInput = z.input<typeof invoiceInput>;
export type InvoiceFormData = z.output<typeof invoiceInput>;

export const confirmInvoiceInput = invoiceInput.extend({ acceptDifferences: z.boolean().default(false) });
export type ConfirmInvoiceInput = z.input<typeof confirmInvoiceInput>;

export const idInput = z.object({ id: uuid });

/** Alta de proveedor desde los datos leídos de la factura. */
export const supplierFromDraftInput = z.object({ invoiceId: uuid });

// --- Órdenes de compra (RF-10) ------------------------------------------------------------

export const orderItemInput = z.object({
  ingredientId: uuid,
  qty: decimal({ min: 0.001, message: "Ingresá una cantidad" }),
  estimatedUnitPrice: optDecimal({ min: 0 }),
});

export const purchaseOrderInput = z.object({
  supplierId: uuid,
  orderedAt: isoDate(),
  expectedAt: optIsoDate(),
  responsibleId: optUuid(),
  notes: optText(),
  items: z.array(orderItemInput).min(1, "Agregá al menos un insumo"),
});
export type PurchaseOrderFormInput = z.input<typeof purchaseOrderInput>;
export type PurchaseOrderData = z.output<typeof purchaseOrderInput>;
export const updatePurchaseOrderInput = purchaseOrderInput.extend({ id: uuid });

export const orderStatusInput = z.object({ id: uuid, status: z.enum(["sent", "cancelled"]) });

// --- Recepción (RF-11) --------------------------------------------------------------------

export const receptionLineInput = z.object({
  ingredientId: uuid,
  /** 0 = esta línea no llegó. */
  qty: decimal({ min: 0 }),
  supplierLotCode: optText(),
  expiryDate: optIsoDate(),
  temperatureC: optDecimal({ min: -40, max: 60 }),
  locationId: uuid,
});

export const receptionInput = z.object({
  supplierId: uuid,
  purchaseOrderId: optUuid(),
  deliveryNote: optText(),
  notes: optText(),
  lines: z.array(receptionLineInput).min(1, "Agregá al menos un insumo"),
});
export type ReceptionFormInput = z.input<typeof receptionInput>;
export type ReceptionData = z.output<typeof receptionInput>;

// --- Cuenta corriente (RF-12) -------------------------------------------------------------

export const supplierPaymentInput = z.object({
  supplierId: uuid,
  date: isoDate(),
  amount: decimal({ min: 0.01, message: "Ingresá el importe" }),
  method: z.enum(PAYMENT_METHODS),
  reference: optText(),
  notes: optText(),
});
export type SupplierPaymentFormInput = z.input<typeof supplierPaymentInput>;
export type SupplierPaymentData = z.output<typeof supplierPaymentInput>;
