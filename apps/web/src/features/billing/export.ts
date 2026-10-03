import type { Executor } from "@chipa/db";
import { buildXlsx, cols } from "@/server/export/xlsx";
import { PAYMENT_METHOD } from "@/lib/labels";
import { CHECK_STATUS, INVOICE_TYPE_LABEL } from "./labels";
import { effectivePaymentAmount, getBillingExportData, getSalesByChannel } from "./service";

const SOURCE = { manual: "Manual", ai: "IA", arca_import: "ARCA" } as const;
const STATUS = { draft: "Borrador", confirmed: "Confirmada", voided: "Anulada" } as const;

/** Excel para la contadora: facturas emitidas y cobros del mes (más un resumen por canal). */
export async function buildBillingWorkbook(db: Executor, month: string): Promise<Buffer> {
  const [data, sales] = await Promise.all([getBillingExportData(db, month), getSalesByChannel(db, month)]);

  const invoiceRows = data.invoices.map(({ invoice: i, customerName, cuit }) => ({ i, customerName, cuit }));
  type PaymentWithChecks = (typeof data.payments)[number];
  type PaymentLine = { p: PaymentWithChecks; c: PaymentWithChecks["checks"][number] | null; amount: number };
  const paymentRows: PaymentLine[] = data.payments.flatMap((p): PaymentLine[] =>
    p.checks.length > 0
      ? p.checks.map((c) => ({ p, c, amount: c.amount }))
      : [{ p, c: null, amount: effectivePaymentAmount({ ...p, checks: [] }) }],
  );

  return buildXlsx([
    {
      name: "Facturas emitidas",
      rows: invoiceRows,
      columns: cols<(typeof invoiceRows)[number]>([
        { header: "Fecha", value: (r) => r.i.issueDate, format: "date" },
        { header: "Tipo", value: (r) => INVOICE_TYPE_LABEL[r.i.invoiceType] ?? r.i.invoiceType, width: 18 },
        { header: "Punto de venta", value: (r) => r.i.pointOfSale },
        { header: "Número", value: (r) => r.i.number },
        { header: "Cliente", value: (r) => r.customerName, width: 32 },
        { header: "CUIT", value: (r) => r.cuit, width: 14 },
        { header: "Neto gravado", value: (r) => r.i.netTotal, format: "money", width: 16 },
        { header: "IVA", value: (r) => r.i.vatTotal, format: "money", width: 14 },
        { header: "Total", value: (r) => r.i.total, format: "money", width: 16 },
        { header: "CAE", value: (r) => r.i.cae, width: 16 },
        { header: "Vencimiento", value: (r) => r.i.dueDate, format: "date" },
        { header: "Origen", value: (r) => SOURCE[r.i.source] },
        { header: "Estado", value: (r) => STATUS[r.i.status] },
      ]),
    },
    {
      name: "Cobros",
      rows: paymentRows,
      columns: cols<(typeof paymentRows)[number]>([
        { header: "Fecha", value: (r) => r.p.date, format: "date" },
        { header: "Cliente", value: (r) => r.p.customer.legalName, width: 32 },
        { header: "CUIT", value: (r) => r.p.customer.cuit, width: 14 },
        { header: "Medio", value: (r) => PAYMENT_METHOD[r.p.method] ?? r.p.method },
        { header: "Importe", value: (r) => r.amount, format: "money", width: 16 },
        { header: "Referencia", value: (r) => r.p.reference, width: 20 },
        { header: "Banco", value: (r) => r.c?.bank ?? null, width: 18 },
        { header: "N° de cheque", value: (r) => r.c?.number ?? null, width: 14 },
        {
          header: "Fecha de cobro del cheque",
          value: (r) => r.c?.cashDate ?? null,
          format: "date",
          width: 22,
        },
        {
          header: "Estado del cheque",
          value: (r) => (r.c ? (CHECK_STATUS[r.c.status]?.label ?? r.c.status) : null),
          width: 16,
        },
      ]),
    },
    {
      name: "Ventas por canal",
      rows: Object.entries(sales.byChannel),
      columns: cols<[string, { net: number; total: number; documents: number }]>([
        { header: "Canal", value: ([ch]) => ch },
        { header: "Neto", value: ([, v]) => v.net, format: "money", width: 16 },
        { header: "Total con IVA", value: ([, v]) => v.total, format: "money", width: 16 },
        { header: "Comprobantes", value: ([, v]) => v.documents, format: "int" },
      ]),
    },
  ]);
}
