import Link from "next/link";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText, Kg, Money } from "@/components/app/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ORDER_STATUS } from "@/lib/labels";
import type { OrderRow } from "../service";

export function OrderStatusBadge({ status }: { status: string }) {
  const s = ORDER_STATUS[status];
  return <StatusBadge tone={s?.tone}>{s?.label ?? status}</StatusBadge>;
}

/** Listado de pedidos (RF-03). Marca con un badge los atrasados. */
export function OrdersTable({ rows, showCustomer = true }: { rows: OrderRow[]; showCustomer?: boolean }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pedido</TableHead>
            {showCustomer ? <TableHead>Cliente</TableHead> : null}
            <TableHead>Entrega</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Peso</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((o) => (
            <TableRow key={o.id}>
              <TableCell>
                <Link href={`/pedidos/${o.id}`} className="font-medium hover:underline">
                  #{o.number}
                </Link>
              </TableCell>
              {showCustomer ? (
                <TableCell className="max-w-28 truncate sm:max-w-48">{o.customerName}</TableCell>
              ) : null}
              <TableCell>
                <div className="flex flex-wrap items-center gap-1">
                  <DateText value={o.promisedDate} />
                  {o.overdue ? <StatusBadge tone="bad">Atrasado</StatusBadge> : null}
                </div>
              </TableCell>
              <TableCell>
                <OrderStatusBadge status={o.status} />
              </TableCell>
              <TableCell className="hidden text-right sm:table-cell">
                <Kg value={o.kg} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={o.total} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
