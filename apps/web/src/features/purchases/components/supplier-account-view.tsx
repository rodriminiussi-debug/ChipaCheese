import { DateText, Money } from "@/components/app/format";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SupplierAccount } from "../account";
import { PaymentDialog } from "./payment-dialog";

/** Cuenta corriente con un proveedor (RF-12): saldo, antigüedad, vencimientos abiertos y movimientos. */
export function SupplierAccountView({
  supplierId,
  account,
  today,
  canPay,
}: {
  supplierId: string;
  account: SupplierAccount;
  today: string;
  canPay: boolean;
}) {
  const { aging } = account;
  const overdue = aging.total - aging.current;
  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          testId="supplier-balance"
          title="Saldo (les debemos)"
          value={<Money value={account.balance} />}
          tone={account.balance > 0 ? "warn" : "default"}
        />
        <StatCard title="Vencido" value={<Money value={overdue} />} tone={overdue > 0 ? "bad" : "default"} />
        <StatCard title="Por vencer" value={<Money value={aging.current} />} />
        <div className="flex items-center sm:justify-end">
          {canPay ? <PaymentDialog supplierId={supplierId} today={today} suggestedAmount={account.balance} /> : null}
        </div>
      </div>

      <section>
        <h3 className="mb-2 font-semibold">Antigüedad de la deuda</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(
            [
              ["No vencido", aging.current],
              ["1 a 30 días", aging.d1_30],
              ["31 a 60 días", aging.d31_60],
              ["61 a 90 días", aging.d61_90],
              ["Más de 90", aging.d90_plus],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-lg border p-3">
              <div className="text-muted-foreground text-xs">{label}</div>
              <Money value={value} className="text-lg font-medium" />
            </div>
          ))}
        </div>
      </section>

      {account.openCharges.length ? (
        <section>
          <h3 className="mb-2 font-semibold">Facturas abiertas</h3>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Comprobante</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead className="text-right">Pendiente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {account.openCharges.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.label}</TableCell>
                    <TableCell>
                      <DateText value={c.dueDate} />{" "}
                      {c.overdue ? <StatusBadge tone="bad">Vencida</StatusBadge> : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={c.open} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      <section>
        <h3 className="mb-2 font-semibold">Movimientos</h3>
        {account.statement.length === 0 ? (
          <p className="text-muted-foreground text-sm">Todavía no hay facturas confirmadas ni pagos.</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Detalle</TableHead>
                  <TableHead className="text-right">Debe</TableHead>
                  <TableHead className="text-right">Haber</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {account.statement.map((r) => (
                  <TableRow key={`${r.kind}-${r.id}`}>
                    <TableCell>
                      <DateText value={r.date} />
                    </TableCell>
                    <TableCell>{r.label}</TableCell>
                    <TableCell className="text-right">{r.kind === "charge" ? <Money value={r.amount} /> : null}</TableCell>
                    <TableCell className="text-right">{r.kind === "credit" ? <Money value={r.amount} /> : null}</TableCell>
                    <TableCell className="text-right font-medium">
                      <Money value={r.balance} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
