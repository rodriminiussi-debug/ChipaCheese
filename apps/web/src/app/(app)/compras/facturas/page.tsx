import Link from "next/link";
import { Plus } from "lucide-react";
import { formatInvoiceNumber } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText, Money } from "@/components/app/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listInvoices } from "@/features/purchases/service";
import { INVOICE_SOURCE, INVOICE_STATUS, INVOICE_TYPE } from "@/features/purchases/labels";
import { can } from "@/lib/rbac";

export const metadata = { title: "Facturas de compra" };

export default async function InvoicesPage(props: PageProps<"/compras/facturas">) {
  const user = await requirePermission("purchases:read");
  const { q, estado } = await props.searchParams;
  const query = typeof q === "string" ? q : undefined;
  const status = estado === "draft" || estado === "confirmed" ? estado : undefined;
  const invoices = await listInvoices(db, { q: query, status });

  return (
    <>
      <PageHeader
        title="Facturas de compra"
        description="Subí la foto de la factura y la IA carga el borrador; vos revisás y confirmás (RF-08)."
        actions={
          can(user.role, "purchases:write") ? (
            <Button asChild>
              <Link href="/compras/facturas/nueva">
                <Plus /> Nueva factura
              </Link>
            </Button>
          ) : null
        }
      />
      <form className="mb-4 flex max-w-xl flex-wrap gap-2">
        <Input
          name="q"
          placeholder="Buscar por proveedor o número…"
          defaultValue={query}
          aria-label="Buscar facturas"
          className="min-w-48 flex-1"
        />
        <select
          name="estado"
          defaultValue={status ?? ""}
          aria-label="Estado"
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          <option value="">Todas</option>
          <option value="draft">Borradores</option>
          <option value="confirmed">Confirmadas</option>
        </select>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
      </form>
      {invoices.length === 0 ? (
        <EmptyState title="No hay facturas" description="Cargá la primera con una foto." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Comprobante</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead className="hidden md:table-cell">Emisión</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Link href={`/compras/facturas/${i.id}`} className="font-medium hover:underline">
                      {INVOICE_TYPE[i.invoiceType]} {formatInvoiceNumber(i.pointOfSale, i.number)}
                    </Link>
                    <div className="text-muted-foreground text-xs">{INVOICE_SOURCE[i.source]}</div>
                  </TableCell>
                  <TableCell>
                    {i.supplier?.legalName ?? <span className="text-muted-foreground">Sin proveedor</span>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <DateText value={i.issueDate} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={INVOICE_STATUS[i.status]!.tone}>
                      {INVOICE_STATUS[i.status]!.label}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={i.total} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
