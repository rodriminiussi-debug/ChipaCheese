import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DateText, Money } from "@/components/app/format";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InvoiceDialog } from "@/features/billing/components/invoice-dialog";
import { PaymentDialog } from "@/features/billing/components/payment-dialog";
import { LinkOrder } from "@/features/billing/components/link-order";
import { AGING_LABELS, INVOICE_STATE } from "@/features/billing/labels";
import { deliveredOrdersToInvoice, getCustomerAccount } from "@/features/billing/service";
import { todayAR } from "@/lib/dates";
import { CHANNEL } from "@/lib/labels";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Cuenta corriente" };

export default async function CustomerAccountPage(props: PageProps<"/cobranzas/clientes/[id]">) {
  const user = await requirePermission("billing:read");
  const { id } = await props.params;
  const today = todayAR();
  const account = await getCustomerAccount(db, id, today);
  if (!account) notFound();
  const { customer } = account;
  const canCollect = can(user.role, ["collections:write", "billing:write"]);
  const canInvoice = can(user.role, "billing:write");
  const orders = canInvoice ? await deliveredOrdersToInvoice(db, id) : [];

  return (
    <>
      <PageHeader
        title={customer.legalName}
        description={`${CHANNEL[customer.channel]} · ${customer.zone?.name ?? "sin zona"} · ${
          customer.paymentTermsDays ? `plazo ${customer.paymentTermsDays} días` : "contado"
        }${customer.paymentNotes ? ` · ${customer.paymentNotes}` : ""}`}
        actions={
          <>
            {canCollect ? (
              <PaymentDialog
                customerId={customer.id}
                customerName={customer.legalName}
                today={today}
                balance={account.balance}
              />
            ) : null}
            {canInvoice ? (
              <InvoiceDialog
                customers={[{ id: customer.id, name: customer.legalName }]}
                customerId={customer.id}
                orders={orders}
                today={today}
              />
            ) : null}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          title={account.balance < 0 ? "Saldo a favor" : "Saldo"}
          value={<Money value={Math.abs(account.balance)} />}
          tone={account.balance > 0 ? "warn" : "good"}
          testId="stat-balance"
        />
        <StatCard
          title="Vencido"
          value={<Money value={account.overdue} />}
          tone={account.overdue > 0 ? "bad" : "good"}
          testId="stat-overdue"
        />
        {AGING_LABELS.slice(0, 2).map(([key, label]) => (
          <StatCard key={key} title={label} value={<Money value={account.buckets[key]} />} />
        ))}
      </div>

      {account.rejectedChecks.length > 0 ? (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle />
          <AlertTitle>Cheques rechazados</AlertTitle>
          <AlertDescription>
            {account.rejectedChecks.map((c) => (
              <div key={c.id}>
                N° {c.number} ({c.bank}) por <Money value={c.amount} />: ya no cuenta como cobro, la deuda
                volvió a la cuenta corriente.
              </div>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-label="Antigüedad de la deuda" className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">Antigüedad de la deuda</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {AGING_LABELS.map(([key, label]) => (
            <div key={key} className="rounded-lg border p-3">
              <div className="text-muted-foreground text-xs">{label}</div>
              <div className="font-semibold tabular-nums">
                <Money value={account.buckets[key]} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Facturas" className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Facturas</h2>
        <div className="rounded-lg border">
          <Table aria-label="Facturas del cliente">
            <TableHeader>
              <TableRow>
                <TableHead>Comprobante</TableHead>
                <TableHead>Emisión</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Cobrado</TableHead>
                <TableHead className="text-right">Pendiente</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {account.invoices.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <div className="font-medium">{i.label}</div>
                    {i.orderId ? (
                      <Link
                        href={`/pedidos/${i.orderId}`}
                        className="text-muted-foreground text-xs hover:underline"
                      >
                        Pedido #{i.orderNumber}
                      </Link>
                    ) : canInvoice && orders.length ? (
                      <LinkOrder
                        invoiceId={i.id}
                        orders={orders.map((o) => ({ id: o.id, number: o.number, total: o.total }))}
                      />
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <DateText value={i.issueDate} />
                  </TableCell>
                  <TableCell>
                    <DateText value={i.dueDate} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={i.total} />
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    <Money value={i.paid} />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <Money value={i.open} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={INVOICE_STATE[i.state]!.tone}>
                      {INVOICE_STATE[i.state]!.label}
                    </StatusBadge>
                  </TableCell>
                </TableRow>
              ))}
              {account.invoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground text-center">
                    Todavía no tiene facturas.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          Los cobros se imputan a la factura que vence primero. Un cheque rechazado deja de contar como cobro.
        </p>
      </section>

      <section aria-label="Estado de cuenta">
        <h2 className="mb-2 text-lg font-semibold">Estado de cuenta</h2>
        <div className="rounded-lg border">
          <Table aria-label="Movimientos de la cuenta corriente">
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Movimiento</TableHead>
                <TableHead className="text-right">Cargo</TableHead>
                <TableHead className="text-right">Crédito</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {account.statement.map((r) => (
                <TableRow key={`${r.kind}-${r.id}`}>
                  <TableCell>
                    <DateText value={r.date} />
                  </TableCell>
                  <TableCell>
                    <div>{r.label}</div>
                    {r.detail ? <div className="text-muted-foreground text-xs">{r.detail}</div> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.kind === "charge" ? <Money value={r.amount} /> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.kind === "credit" ? <Money value={r.amount} /> : null}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <Money value={r.balance} />
                  </TableCell>
                </TableRow>
              ))}
              {account.statement.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    Sin movimientos.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>
    </>
  );
}
