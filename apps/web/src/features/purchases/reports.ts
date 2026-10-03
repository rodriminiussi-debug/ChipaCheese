import { and, asc, eq, inArray, schema, sql, type Executor } from "@chipa/db";
import { addMonths, roundMoney, type IsoDate } from "@chipa/domain";

/** "Cuánto se gastó en el mes" (RF-12) y datos para la exportación a la contadora. */

export interface SpendTotals {
  net: number;
  vat: number;
  otherTaxes: number;
  total: number;
  invoices: number;
}

const zero = (): SpendTotals => ({ net: 0, vat: 0, otherTaxes: 0, total: 0, invoices: 0 });

type Row = {
  supplierId: string | null;
  supplierName: string | null;
  invoiceType: string;
  net: number;
  vat: number;
  other: number;
  total: number;
};

function accumulate(acc: SpendTotals, r: Row) {
  // Las notas de crédito restan.
  const sign = r.invoiceType.startsWith("NC_") ? -1 : 1;
  acc.net = roundMoney(acc.net + sign * r.net);
  acc.vat = roundMoney(acc.vat + sign * r.vat);
  acc.otherTaxes = roundMoney(acc.otherTaxes + sign * r.other);
  acc.total = roundMoney(acc.total + sign * r.total);
  acc.invoices += 1;
}

async function confirmedInvoicesBetween(
  db: Executor,
  from: IsoDate,
  toExclusive: IsoDate,
): Promise<(Row & { month: string })[]> {
  const i = schema.purchaseInvoices;
  const rows = await db
    .select({
      supplierId: i.supplierId,
      supplierName: schema.suppliers.legalName,
      invoiceType: i.invoiceType,
      net: i.netTotal,
      vat: i.vatTotal,
      other: i.otherTaxes,
      total: i.total,
      issueDate: i.issueDate,
    })
    .from(i)
    .leftJoin(schema.suppliers, eq(schema.suppliers.id, i.supplierId))
    .where(
      and(
        eq(i.status, "confirmed"),
        sql`${i.issueDate} >= ${from}::date`,
        sql`${i.issueDate} < ${toExclusive}::date`,
      ),
    );
  return rows.map((r) => ({ ...r, month: r.issueDate!.slice(0, 7) }));
}

/** Total neto/IVA/total del mes (por fecha de emisión), desglosado por proveedor. */
export async function monthlySpend(db: Executor, month: string) {
  const from = `${month}-01`;
  const rows = await confirmedInvoicesBetween(db, from, addMonths(from, 1));
  const totals = zero();
  const bySupplier = new Map<string, SpendTotals & { supplierId: string | null; name: string }>();
  for (const r of rows) {
    accumulate(totals, r);
    const key = r.supplierId ?? "none";
    const entry = bySupplier.get(key) ?? {
      ...zero(),
      supplierId: r.supplierId,
      name: r.supplierName ?? "Sin proveedor",
    };
    accumulate(entry, r);
    bySupplier.set(key, entry);
  }
  return { month, totals, bySupplier: [...bySupplier.values()].sort((a, b) => b.total - a.total) };
}

/** Gasto de los últimos `months` meses terminando en `month` (inclusive), del más viejo al más nuevo. */
export async function spendByMonth(db: Executor, month: string, months = 6) {
  const start = addMonths(`${month}-01`, -(months - 1));
  const rows = await confirmedInvoicesBetween(db, start, addMonths(`${month}-01`, 1));
  return Array.from({ length: months }, (_, k) => {
    const m = addMonths(start, k).slice(0, 7);
    const totals = zero();
    for (const r of rows) if (r.month === m) accumulate(totals, r);
    return { month: m, ...totals };
  });
}

/** Facturas confirmadas del mes con sus renglones, para la planilla de la contadora. */
export async function purchasesForExport(db: Executor, month: string) {
  const from = `${month}-01`;
  const i = schema.purchaseInvoices;
  const invoices = await db.query.purchaseInvoices.findMany({
    where: and(
      eq(i.status, "confirmed"),
      sql`${i.issueDate} >= ${from}::date`,
      sql`${i.issueDate} < ${addMonths(from, 1)}::date`,
    ),
    with: { supplier: true },
    orderBy: [asc(i.issueDate), asc(i.pointOfSale), asc(i.number)],
  });
  const items = invoices.length
    ? await db.query.purchaseInvoiceItems.findMany({
        where: inArray(
          schema.purchaseInvoiceItems.invoiceId,
          invoices.map((x) => x.id),
        ),
        with: { ingredient: true },
        orderBy: asc(schema.purchaseInvoiceItems.createdAt),
      })
    : [];
  return { invoices, items };
}
