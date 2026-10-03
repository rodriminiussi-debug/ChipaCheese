import Link from "next/link";
import { Plus } from "lucide-react";
import { formatCuit } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { Money } from "@/components/app/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listSuppliers } from "@/features/suppliers/service";
import { listSupplierBalances } from "@/features/purchases/service";
import { can } from "@/lib/rbac";
import { todayAR } from "@/lib/dates";

export const metadata = { title: "Proveedores" };

export default async function SuppliersPage(props: PageProps<"/proveedores">) {
  const user = await requirePermission("suppliers:read");
  const { q } = await props.searchParams;
  const query = typeof q === "string" ? q : undefined;
  const showBalance = can(user.role, "purchases:read");
  const [suppliers, balances] = await Promise.all([
    listSuppliers(db, { q: query }),
    showBalance ? listSupplierBalances(db, todayAR()) : Promise.resolve([]),
  ]);
  const balanceOf = new Map(balances.map((b) => [b.supplierId, b]));

  return (
    <>
      <PageHeader
        title="Proveedores"
        description="Ficha de proveedor: insumos que vende, plazo de entrega, condición de pago y cuenta corriente (RF-07)."
        actions={
          can(user.role, "suppliers:write") ? (
            <Button asChild>
              <Link href="/proveedores/nuevo">
                <Plus /> Nuevo proveedor
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
          aria-label="Buscar proveedores"
        />
      </form>
      {suppliers.length === 0 ? (
        <EmptyState
          title="No hay proveedores"
          description={query ? "Probá con otra búsqueda." : "Cargá el primero."}
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proveedor</TableHead>
                <TableHead className="hidden md:table-cell">Entrega</TableHead>
                <TableHead className="hidden md:table-cell">Pago</TableHead>
                <TableHead className="hidden lg:table-cell">WhatsApp</TableHead>
                {showBalance ? <TableHead className="text-right">Saldo</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((s) => {
                const b = balanceOf.get(s.id);
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link href={`/proveedores/${s.id}`} className="font-medium hover:underline">
                        {s.legalName}
                      </Link>
                      {s.cuit ? (
                        <div className="text-muted-foreground text-xs">{formatCuit(s.cuit)}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden tabular-nums md:table-cell">
                      {s.leadTimeDays} {s.leadTimeDays === 1 ? "día" : "días"}
                    </TableCell>
                    <TableCell className="hidden tabular-nums md:table-cell">
                      {s.paymentTermsDays ? `${s.paymentTermsDays} días` : "Contado"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{s.whatsapp ?? "—"}</TableCell>
                    {showBalance ? (
                      <TableCell className="text-right">
                        {b ? (
                          <>
                            <Money value={b.balance} />
                            {b.overdue > 0 ? (
                              <div>
                                <StatusBadge tone="bad">Vencido</StatusBadge>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
