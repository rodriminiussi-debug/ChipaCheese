import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listCustomers } from "@/features/customers/service";
import { can } from "@/lib/rbac";
import { CHANNEL } from "@/lib/labels";
import { formatCuit } from "@chipa/domain";

export const metadata = { title: "Clientes" };

export default async function CustomersPage(props: PageProps<"/clientes">) {
  const user = await requirePermission("customers:read");
  const { q } = await props.searchParams;
  const query = typeof q === "string" ? q : undefined;
  const customers = await listCustomers(db, { q: query });

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Ficha de cliente: canal, lista de precios, zona, días de entrega y condición de pago (RF-01)."
        actions={
          can(user.role, "customers:write") ? (
            <Button asChild>
              <Link href="/clientes/nuevo">
                <Plus /> Nuevo cliente
              </Link>
            </Button>
          ) : null
        }
      />
      <form className="mb-4 max-w-sm">
        <Input
          name="q"
          placeholder="Buscar por nombre o CUIT…"
          defaultValue={query}
          aria-label="Buscar clientes"
        />
      </form>
      {customers.length === 0 ? (
        <EmptyState
          title="No hay clientes"
          description={query ? "Probá con otra búsqueda." : "Cargá el primero."}
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead className="hidden md:table-cell">Zona</TableHead>
                <TableHead className="hidden lg:table-cell">Lista de precios</TableHead>
                <TableHead className="text-right">Plazo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/clientes/${c.id}`} className="font-medium hover:underline">
                      {c.legalName}
                    </Link>
                    {c.cuit ? (
                      <div className="text-muted-foreground text-xs">{formatCuit(c.cuit)}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={c.channel === "supermarket" ? "info" : "neutral"}>
                      {CHANNEL[c.channel]}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{c.zone?.name ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">{c.priceList?.name ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.paymentTermsDays ? `${c.paymentTermsDays} días` : "Contado"}
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
