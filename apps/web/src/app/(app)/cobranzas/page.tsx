import Link from "next/link";
import { AlertTriangle, Download } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { DateText, Money } from "@/components/app/format";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InvoiceDialog } from "@/features/billing/components/invoice-dialog";
import { AGING_LABELS } from "@/features/billing/labels";
import {
  deliveredOrdersToInvoice,
  getReceivables,
  listChecks,
  routesForDate,
} from "@/features/billing/service";
import { listCustomers } from "@/features/customers/service";
import { todayAR } from "@/lib/dates";
import { CHANNEL } from "@/lib/labels";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Cobranzas" };

export default async function ReceivablesPage() {
  const user = await requirePermission("billing:read");
  const today = todayAR();
  const canWrite = can(user.role, "billing:write");
  const canRoute = can(user.role, "collections:write");
  const [receivables, checks, routes, customers, orders] = await Promise.all([
    getReceivables(db, today),
    listChecks(db, {}, today),
    canRoute ? routesForDate(db, today) : [],
    canWrite ? listCustomers(db) : [],
    canWrite ? deliveredOrdersToInvoice(db) : [],
  ]);
  const { rows, buckets } = receivables;

  return (
    <>
      <PageHeader
        title="Cobranzas"
        description="Cuenta corriente por cliente: facturas, cobros, saldo y antigüedad de la deuda (RF-30)."
        actions={
          <>
            <form action="/api/billing/export" method="get" className="flex items-center gap-2">
              <Input
                type="month"
                name="month"
                aria-label="Mes a exportar"
                defaultValue={today.slice(0, 7)}
                className="w-40"
              />
              <Button type="submit" variant="outline">
                <Download /> Excel del mes
              </Button>
            </form>
            {canWrite ? (
              <InvoiceDialog
                customers={customers.map((c) => ({ id: c.id, name: c.legalName }))}
                orders={orders}
                today={today}
              />
            ) : null}
          </>
        }
      />

      {checks.totals.dueSoonCount > 0 || checks.totals.readyToDepositCount > 0 ? (
        <Alert className="mb-4">
          <AlertTriangle />
          <AlertTitle>Cheques para atender</AlertTitle>
          <AlertDescription>
            {checks.totals.dueSoonCount > 0 ? (
              <>
                {checks.totals.dueSoonCount} cheque(s) por <Money value={checks.totals.dueSoon} /> se cobran
                en los próximos 7 días.{" "}
              </>
            ) : null}
            {checks.totals.readyToDepositCount > 0 ? (
              <>
                {checks.totals.readyToDepositCount} cheque(s) por{" "}
                <Money value={checks.totals.readyToDeposit} /> ya se pueden depositar.{" "}
              </>
            ) : null}
            <Link href="/cobranzas/cheques" className="underline">
              Ver cartera
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Deuda total" value={<Money value={receivables.total} />} testId="stat-total" />
        <StatCard
          title="Vencida"
          value={<Money value={receivables.overdue} />}
          tone={receivables.overdue > 0 ? "bad" : "good"}
          hint={receivables.overdue > 0 ? "Pasó la fecha de vencimiento" : "Nada vencido"}
        />
        <StatCard
          title="Clientes con deuda"
          value={receivables.customersWithDebt}
          hint={`${rows.length} con movimientos abiertos`}
        />
        <StatCard
          title="Cheques en cartera"
          value={<Money value={checks.totals.inPortfolio} />}
          hint={
            <Link href="/cobranzas/cheques" className="underline">
              Ver cartera
            </Link>
          }
        />
      </div>

      <section aria-label="Antigüedad de la deuda" className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">Antigüedad de la deuda</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {AGING_LABELS.map(([key, label]) => (
            <div key={key} className="rounded-lg border p-3">
              <div className="text-muted-foreground text-xs">{label}</div>
              <div className="font-semibold tabular-nums">
                <Money value={buckets[key]} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {routes.length > 0 ? (
        <section aria-label="Rutas de hoy" className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">Cobrar en ruta</h2>
          <div className="flex flex-wrap gap-2">
            {routes.map((r, i) => (
              <Button key={r.id} asChild variant="outline">
                <Link href={`/cobranzas/ruta/${r.id}` as never}>
                  Ruta {i + 1} de hoy · {r.stops.length} parada(s)
                </Link>
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-label="Clientes con saldo">
        <h2 className="mb-2 text-lg font-semibold">Clientes con saldo</h2>
        {rows.length === 0 ? (
          <EmptyState title="Nadie debe nada" description="Cuando se cargue una factura, aparece acá." />
        ) : (
          <div className="rounded-lg border">
            <Table aria-label="Saldos por cliente">
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="hidden md:table-cell">Canal</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Vencido</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">A vencer</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">1–30 d</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">31–60 d</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">+60 d</TableHead>
                  <TableHead className="hidden sm:table-cell">Vence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.customerId}>
                    <TableCell>
                      <Link
                        href={`/cobranzas/clientes/${r.customerId}` as never}
                        className="font-medium hover:underline"
                      >
                        {r.legalName}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <StatusBadge tone={r.channel === "supermarket" ? "info" : "neutral"}>
                        {CHANNEL[r.channel]}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <Money value={r.balance} />
                      {r.balance < 0 ? <div className="text-muted-foreground text-xs">a favor</div> : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.overdue > 0 ? <Money value={r.overdue} className="text-destructive" /> : "—"}
                    </TableCell>
                    <TableCell className="hidden text-right lg:table-cell">
                      <Money value={r.buckets.current} />
                    </TableCell>
                    <TableCell className="hidden text-right lg:table-cell">
                      <Money value={r.buckets.d1_30} />
                    </TableCell>
                    <TableCell className="hidden text-right lg:table-cell">
                      <Money value={r.buckets.d31_60} />
                    </TableCell>
                    <TableCell className="hidden text-right lg:table-cell">
                      <Money value={r.buckets.d61_90 + r.buckets.d90_plus} />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <DateText value={r.oldestDueDate} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </>
  );
}
