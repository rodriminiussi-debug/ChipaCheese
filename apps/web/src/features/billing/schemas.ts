import { z } from "zod";
import { decimal, isoDate, optIsoDate, optText, optUuid } from "@/lib/zod";

export const INVOICE_TYPES = ["A", "B", "C", "X", "NC_A", "NC_B", "NC_C"] as const;
export const PAYMENT_METHODS = ["cash", "transfer", "check", "card", "other"] as const;
export const CHECK_STATUSES = ["in_portfolio", "deposited", "cashed", "rejected", "endorsed"] as const;

/** Importe opcional: vacío / ausente → null. */
const optMoney = (min: number) =>
  z
    .union([z.literal(""), decimal({ min })])
    .nullish()
    .transform((v) => (v === "" || v == null ? null : v));

/** Punto de venta de 4 dígitos y número de 8 (formato ARCA); idempotente. */
const pointOfSale = z
  .string()
  .trim()
  .regex(/^\d{1,5}$/, "Punto de venta inválido (solo números)")
  .transform((v) => v.padStart(4, "0"));
const invoiceNumber = z
  .string()
  .trim()
  .regex(/^\d{1,8}$/, "Número inválido (solo números)")
  .transform((v) => v.padStart(8, "0"));

/** RF-30: alta manual de factura emitida. El IVA es el de la factura (Regla 11), no se calcula. */
export const invoiceInput = z.object({
  customerId: z.string().uuid("Elegí el cliente"),
  invoiceType: z.enum(INVOICE_TYPES),
  pointOfSale,
  number: invoiceNumber,
  issueDate: isoDate(),
  /** Vacío = emisión + plazo de pago del cliente. */
  dueDate: optIsoDate(),
  netTotal: decimal({ min: 0, message: "Ingresá el neto gravado" }),
  vatTotal: optMoney(0),
  total: decimal({ min: 0.01, message: "Ingresá el total" }),
  cae: optText(),
  /** Pedido entregado que se factura (pasa a "facturado"). */
  orderId: optUuid(),
});
export type InvoiceInput = z.input<typeof invoiceInput>;
export type InvoiceData = z.output<typeof invoiceInput>;

export const checkInput = z.object({
  bank: z.string().trim().min(2, "Ingresá el banco"),
  number: z.string().trim().min(1, "Ingresá el número del cheque"),
  issuer: optText(),
  amount: decimal({ min: 0.01, message: "Ingresá el importe" }),
  issueDate: optIsoDate(),
  /** Fecha a partir de la cual se puede cobrar. */
  cashDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ingresá la fecha de cobro"),
});
export type CheckInput = z.input<typeof checkInput>;
export type CheckData = z.output<typeof checkInput>;

/** RF-31: cobro en efectivo, transferencia o con uno o varios cheques. */
export const paymentInput = z
  .object({
    customerId: z.string().uuid("Elegí el cliente"),
    /** Vacío = hoy. */
    date: optIsoDate(),
    method: z.enum(PAYMENT_METHODS),
    /** Obligatorio salvo con cheques (ahí es la suma de los cheques). */
    amount: optMoney(0.01),
    routeId: optUuid(),
    reference: optText(),
    notes: optText(),
    checks: z.array(checkInput).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.method === "check") {
      if (v.checks.length === 0)
        ctx.addIssue({ code: "custom", path: ["checks"], message: "Cargá al menos un cheque" });
    } else {
      if (v.checks.length > 0)
        ctx.addIssue({
          code: "custom",
          path: ["checks"],
          message: "Solo los cobros con cheque llevan cheques",
        });
      if (v.amount == null || !(v.amount > 0))
        ctx.addIssue({ code: "custom", path: ["amount"], message: "Ingresá el importe" });
    }
  });
export type PaymentInput = z.input<typeof paymentInput>;
export type PaymentData = z.output<typeof paymentInput>;

export const checkStatusInput = z.object({
  checkId: z.string().uuid(),
  status: z.enum(CHECK_STATUSES),
  notes: optText(),
});
export type CheckStatusInput = z.input<typeof checkStatusInput>;
export type CheckStatusData = z.output<typeof checkStatusInput>;

/** RF-32: carga del CSV de "Mis Comprobantes" (emitidos o recibidos). */
export const arcaFileInput = z.object({
  kind: z.enum(["issued", "received"]),
  file: z.instanceof(File, { message: "Elegí el archivo CSV" }),
});
export type ArcaFileInput = z.input<typeof arcaFileInput>;

export const monthInput = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes inválido") });
