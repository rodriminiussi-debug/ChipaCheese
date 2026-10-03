import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { Money } from "@/components/app/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listSupplierBalances } from "@/features/purchases/service";
import { todayAR } from "@/lib/dates";

export const metadata = { title: "Cuentas corrientes con proveedores" };

export default async function SupplierAccountsPage() {
  await requirePermission("purchases:read");
  const rows = await listSupplierBalances(db, todayAR());
  const total = rows.reduce((a, r) => a + r.balance, 0);
  const overdue = rows.reduce((a, r) => a + r.overdue, 0);
  return (
    <>
      <PageHeader
        title="Cuentas corrientes con proveedores"
        description="Facturas confirmadas contra pagos registrados: saldo y antigüedad de la deuda (RF-12)."
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <StatCard title="Les debemos" value={<Money value={total} />} />
        <StatCard title="Vencido" value={<Money value={overdue} />} tone={overdue > 0 ? "bad" : "default"} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Sin movimientos" description="Aparecen al confirmar facturas o registrar pagos." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proveedor</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead className="text-right">Vencido</TableHead>
                <TableHead className="hidden text-right md:table-cell">1–30 días</TableHead>
                <TableHead className="hidden text-right md:table-cell">31–60</TableHead>
                <TableHead className="hidden text-right md:table-cell">+60</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.supplierId}>
                  <TableCell>
                    <Link href={`/proveedores/${r.supplierId}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={r.balance} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={r.overdue} />
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    <Money value={r.aging.d1_30} />
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    <Money value={r.aging.d31_60} />
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    <Money value={r.aging.d61_90 + r.aging.d90_plus} />
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
