import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { formatInvoiceNumber } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { asc, eq, schema } from "@chipa/db";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { fileUrl } from "@/server/storage";
import { getInvoice } from "@/features/purchases/service";
import { InvoiceFile } from "@/features/purchases/components/invoice-file";
import { InvoiceReviewForm } from "@/features/purchases/components/invoice-review-form";
import { InvoiceSummary } from "@/features/purchases/components/invoice-summary";
import { INVOICE_STATUS, INVOICE_TYPE } from "@/features/purchases/labels";
import { toInput } from "@/features/purchases/input";
import type { InvoiceFormInput } from "@/features/purchases/schemas";
import { can } from "@/lib/rbac";

export default async function InvoicePage(props: PageProps<"/compras/facturas/[id]">) {
  const user = await requirePermission("purchases:read");
  const { id } = await props.params;
  const invoice = await getInvoice(db, id);
  if (!invoice) notFound();

  const [suppliers, ingredients] = await Promise.all([
    db.query.suppliers.findMany({ orderBy: asc(schema.suppliers.legalName) }),
    db.query.ingredients.findMany({
      where: eq(schema.ingredients.active, true),
      orderBy: asc(schema.ingredients.name),
    }),
  ]);
  const editable = invoice.status === "draft" && can(user.role, "purchases:write");
  const ai = invoice.aiExtraction as {
    error?: string;
    provider?: string;
    extracted?: { supplierName: string | null; supplierCuit: string | null };
  } | null;
  const status = INVOICE_STATUS[invoice.status]!;

  const noTotals = invoice.netTotal === 0 && invoice.vatTotal === 0 && invoice.total === 0;
  const initial: InvoiceFormInput = {
    id: invoice.id,
    supplierId: invoice.supplierId,
    invoiceType: invoice.invoiceType,
    pointOfSale: invoice.pointOfSale ?? "",
    number: invoice.number ?? "",
    issueDate: invoice.issueDate ?? "",
    dueDate: invoice.dueDate ?? "",
    otherTaxes: toInput(invoice.otherTaxes),
    declaredNet: noTotals ? "" : toInput(invoice.netTotal),
    declaredVat: noTotals ? "" : toInput(invoice.vatTotal),
    declaredTotal: noTotals ? "" : toInput(invoice.total),
    notes: invoice.notes ?? "",
    items: invoice.items.length
      ? invoice.items.map((i) => ({
          description: i.description,
          ingredientId: i.ingredientId,
          qty: toInput(i.qty),
          unit: i.unit,
          unitPriceNet: toInput(i.unitPriceNet),
          vatRate: toInput(i.vatRate),
          vatAmount: toInput(i.vatAmount),
        }))
      : [
          {
            description: "",
            ingredientId: null,
            qty: "",
            unit: null,
            unitPriceNet: "",
            vatRate: "21",
            vatAmount: "",
          },
        ],
  };

  return (
    <>
      <PageHeader
        title={`${INVOICE_TYPE[invoice.invoiceType]} ${formatInvoiceNumber(invoice.pointOfSale, invoice.number)}`}
        description={
          <>
            {invoice.supplier?.legalName ?? "Proveedor sin elegir"}{" "}
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </>
        }
      />
      {ai?.error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle />
          <AlertTitle>No se pudo leer la factura automáticamente</AlertTitle>
          <AlertDescription>{ai.error} Cargá los datos a mano mirando la foto.</AlertDescription>
        </Alert>
      ) : null}
      {invoice.source === "ai" && ai?.provider && invoice.status === "draft" ? (
        <p className="text-muted-foreground mb-4 text-sm">
          Datos leídos por IA: revisalos contra la foto antes de confirmar.
        </p>
      ) : null}

      <div className={invoice.fileKey ? "grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" : ""}>
        {invoice.fileKey ? (
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <details open className="lg:[&>summary]:hidden">
              <summary className="mb-2 cursor-pointer text-sm font-medium">Foto de la factura</summary>
              <InvoiceFile url={fileUrl(invoice.fileKey)} name={invoice.fileKey} />
            </details>
          </aside>
        ) : null}
        <div>
          {editable ? (
            <InvoiceReviewForm
              initial={initial}
              suppliers={suppliers.map((s) => ({ id: s.id, name: s.legalName, cuit: s.cuit }))}
              ingredients={ingredients.map((i) => ({ id: i.id, name: i.name, unit: i.unit }))}
              extracted={ai?.extracted ?? null}
            />
          ) : (
            <InvoiceSummary
              invoice={invoice}
              ingredientNames={new Map(ingredients.map((i) => [i.id, i.name]))}
            />
          )}
        </div>
      </div>
    </>
  );
}
