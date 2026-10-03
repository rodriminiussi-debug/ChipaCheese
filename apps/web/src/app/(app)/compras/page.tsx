import Link from "next/link";
import { Download, FilePlus2, PackagePlus, ShoppingCart } from "lucide-react";
import { addMonths } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { Money } from "@/components/app/format";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { monthlySpend, spendByMonth } from "@/features/purchases/service";
import { monthLabel } from "@/features/purchases/labels";
import { can } from "@/lib/rbac";
import { todayAR } from "@/lib/dates";

export const metadata = { title: "Compras" };

export default async function PurchasesPage(props: PageProps<"/compras">) {
  const user = await requirePermission("purchases:read");
  const { mes } = await props.searchParams;
  const month = typeof mes === "string" && /^\d{4}-\d{2}$/.test(mes) ? mes : todayAR().slice(0, 7);
  const [spend, series] = await Promise.all([monthlySpend(db, month), spendByMonth(db, month, 6)]);
  const prev = addMonths(`${month}-01`, -1).slice(0, 7);
  const next = addMonths(`${month}-01`, 1).slice(0, 7);
  const canExport = can(user.role, ["export", "purchases:read"]);
  const canWrite = can(user.role, "purchases:write");

  return (
    <>
      <PageHeader
        title="Compras"
        description="Cuánto se compró en el mes, por proveedor, y la planilla para la contadora (RF-12)."
        actions={
          <>
            {canWrite ? (
              <>
                <Button asChild>
                  <Link href="/compras/facturas/nueva">
                    <FilePlus2 /> Cargar factura
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/compras/ordenes/nueva">
                    <ShoppingCart /> Nueva orden
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/compras/recepciones/nueva">
                    <PackagePlus /> Recibir mercadería
                  </Link>
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href={{ pathname: "/compras", query: { mes: prev } }}>← {monthLabel(prev)}</Link>
        </Button>
        <h2 className="text-lg font-semibold capitalize">{monthLabel(month)}</h2>
        <Button variant="outline" size="sm" asChild>
          <Link href={{ pathname: "/compras", query: { mes: next } }}>{monthLabel(next)} →</Link>
        </Button>
        {canExport ? (
          <Button size="sm" asChild className="ml-auto">
            <a href={`/compras/exportar?mes=${month}`} download>
              <Download /> Exportar a Excel
            </a>
          </Button>
        ) : null}
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          testId="spend-net"
          title="Neto"
          value={<Money value={spend.totals.net} />}
          hint={`${spend.totals.invoices} facturas`}
        />
        <StatCard testId="spend-vat" title="IVA" value={<Money value={spend.totals.vat} />} />
        <StatCard title="Percepciones y otros" value={<Money value={spend.totals.otherTaxes} />} />
        <StatCard testId="spend-total" title="Total" value={<Money value={spend.totals.total} />} />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-lg font-semibold">Por proveedor</h2>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proveedor</TableHead>
                  <TableHead className="text-right">Neto</TableHead>
                  <TableHead className="text-right">IVA</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spend.bySupplier.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground text-center">
                      Sin facturas confirmadas en este mes.
                    </TableCell>
                  </TableRow>
                ) : (
                  spend.bySupplier.map((s) => (
                    <TableRow key={s.supplierId ?? "none"}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-right">
                        <Money value={s.net} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={s.vat} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={s.total} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold">Últimos 6 meses</h2>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Neto</TableHead>
                  <TableHead className="text-right">IVA</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...series].reverse().map((m) => (
                  <TableRow key={m.month}>
                    <TableCell className="capitalize">{monthLabel(m.month)}</TableCell>
                    <TableCell className="text-right">
                      <Money value={m.net} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={m.vat} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={m.total} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </>
  );
}
