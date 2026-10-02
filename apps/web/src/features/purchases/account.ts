import { and, asc, eq, schema, type Executor } from "@chipa/db";
import {
  accountBalance,
  agingBuckets,
  applyFifo,
  formatInvoiceNumber,
  invoiceDueDate,
  statementWithRunningBalance,
  type AgingBuckets,
  type Charge,
  type Credit,
  type IsoDate,
} from "@chipa/domain";
import { toIsoDateAR } from "@/lib/dates";
import { PAYMENT_METHOD } from "@/lib/labels";
import { UserError } from "@/server/errors";
import type { SupplierPaymentData } from "./schemas";

/**
 * Cuenta corriente con proveedores (RF-12). Cargos = facturas confirmadas (vencen en `dueDate` o
 * emisión + plazo del proveedor); créditos = pagos y notas de crédito. Saldo positivo = les debemos.
 */

type SupplierRow = typeof schema.suppliers.$inferSelect;
type InvoiceRow = typeof schema.purchaseInvoices.$inferSelect;
type PaymentRow = typeof schema.supplierPayments.$inferSelect;

const invoiceDate = (i: InvoiceRow): IsoDate => i.issueDate ?? toIsoDateAR(i.createdAt);

export function buildLedger(supplier: Pick<SupplierRow, "paymentTermsDays">, invoices: InvoiceRow[], payments: PaymentRow[]) {
  const charges: Charge[] = [];
  const credits: Credit[] = [];
  const labels = new Map<string, string>();
  for (const inv of invoices) {
    if (inv.status !== "confirmed") continue;
    const date = invoiceDate(inv);
    const kind = inv.invoiceType.replace("_", " ");
    labels.set(inv.id, `${inv.invoiceType.startsWith("NC_") ? "Nota de crédito" : "Factura"} ${kind.replace("NC ", "")} ${formatInvoiceNumber(inv.pointOfSale, inv.number)}`);
    if (inv.invoiceType.startsWith("NC_")) credits.push({ id: inv.id, date, amount: inv.total });
    else
      charges.push({
        id: inv.id,
        date,
        dueDate: invoiceDueDate({ issueDate: date, dueDate: inv.dueDate, paymentTermsDays: supplier.paymentTermsDays }),
        amount: inv.total,
      });
  }
  for (const p of payments) {
    credits.push({ id: p.id, date: p.date, amount: p.amount });
    labels.set(p.id, `Pago (${PAYMENT_METHOD[p.method] ?? p.method})${p.reference ? ` · ${p.reference}` : ""}`);
  }
  return { charges, credits, labels };
}

export interface SupplierAccount {
  balance: number;
  aging: AgingBuckets;
  statement: { id: string; date: IsoDate; kind: "charge" | "credit"; label: string; amount: number; balance: number }[];
  openCharges: { id: string; label: string; dueDate: IsoDate; open: number; overdue: boolean }[];
}

export async function getSupplierAccount(db: Executor, supplierId: string, today: IsoDate): Promise<SupplierAccount> {
  const supplier = await db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, supplierId) });
  if (!supplier) throw new UserError("El proveedor no existe.");
  const [invoices, payments] = await Promise.all([
    db.query.purchaseInvoices.findMany({
      where: and(eq(schema.purchaseInvoices.supplierId, supplierId), eq(schema.purchaseInvoices.status, "confirmed")),
    }),
    db.query.supplierPayments.findMany({ where: eq(schema.supplierPayments.supplierId, supplierId), orderBy: asc(schema.supplierPayments.date) }),
  ]);
  const { charges, credits, labels } = buildLedger(supplier, invoices, payments);
  const open = applyFifo(charges, credits).filter((c) => c.open > 0);
  return {
    balance: accountBalance(charges, credits),
    aging: agingBuckets(open, today),
    statement: statementWithRunningBalance(charges, credits).map((r) => ({ ...r, label: labels.get(r.id) ?? "" })),
    openCharges: open.map((c) => ({ id: c.chargeId, label: labels.get(c.chargeId) ?? "", dueDate: c.dueDate, open: c.open, overdue: c.dueDate < today })),
  };
}

/** Saldo y deuda vencida de todos los proveedores con movimientos. */
export async function listSupplierBalances(db: Executor, today: IsoDate) {
  const [suppliers, invoices, payments] = await Promise.all([
    db.query.suppliers.findMany({ orderBy: asc(schema.suppliers.legalName) }),
    db.query.purchaseInvoices.findMany({ where: eq(schema.purchaseInvoices.status, "confirmed") }),
    db.query.supplierPayments.findMany(),
  ]);
  return suppliers
    .map((s) => {
      const inv = invoices.filter((i) => i.supplierId === s.id);
      const pay = payments.filter((p) => p.supplierId === s.id);
      const { charges, credits } = buildLedger(s, inv, pay);
      const open = applyFifo(charges, credits).filter((c) => c.open > 0);
      const aging = agingBuckets(open, today);
      return {
        supplierId: s.id,
        name: s.legalName,
        balance: accountBalance(charges, credits),
        overdue: aging.total - aging.current,
        aging,
        movements: inv.length + pay.length,
      };
    })
    .filter((r) => r.movements > 0);
}

export async function registerSupplierPayment(db: Executor, input: SupplierPaymentData) {
  const supplier = await db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, input.supplierId) });
  if (!supplier) throw new UserError("El proveedor no existe.");
  const [row] = await db.insert(schema.supplierPayments).values(input).returning();
  return row!;
}
