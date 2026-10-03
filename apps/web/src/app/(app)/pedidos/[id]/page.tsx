import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { isOrderEditable, isOrderOverdue, nextStatuses, type OrderStatus } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText, Kg, Money } from "@/components/app/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { estimateForOrder, getOrder, kgOf } from "@/features/orders/service";
import { OrderStatusBadge } from "@/features/orders/components/orders-table";
import { StatusActions } from "@/features/orders/components/status-actions";
import { EstimateCard } from "@/features/orders/components/estimate-card";
import { UseDateButton } from "@/features/orders/components/use-date-button";
import { ORDER_SOURCE } from "@/features/orders/labels";
import { formatDateTimeAR, todayAR } from "@/lib/dates";
import { can } from "@/lib/rbac";
import { ORDER_STATUS } from "@/lib/labels";

export async function generateMetadata(props: PageProps<"/pedidos/[id]">) {
  const { id } = await props.params;
  const order = /^[0-9a-f-]{36}$/.test(id) ? await getOrder(db, id) : null;
  return { title: order ? `Pedido #${order.number}` : "Pedido" };
}

const PRODUCTION_VIEW: OrderStatus[] = ["received", "confirmed", "in_production"];

export default async function OrderPage(props: PageProps<"/pedidos/[id]">) {
  const user = await requirePermission("orders:read");
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const order = await getOrder(db, id);
  if (!order) notFound();

  const today = todayAR();
  const canWrite = can(user.role, "orders:write");
  const canMove = canWrite || can(user.role, "dispatch:write");
  // Logística solo registra despacho y entrega (el servidor lo revalida).
  const next = nextStatuses(order.status).filter((s) => canWrite || s === "dispatched" || s === "delivered");
  const overdue = isOrderOverdue({ promisedDate: order.promisedDate, status: order.status, today });
  const kg = kgOf(order.items);
  const estimate = PRODUCTION_VIEW.includes(order.status)
    ? await estimateForOrder(db, order.id, today)
    : null;

  return (
    <>
      <PageHeader
        title={`Pedido #${order.number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/clientes/${order.customerId}`} className="font-medium hover:underline">
              {order.customer.legalName}
            </Link>
            <OrderStatusBadge status={order.status} />
            {overdue ? <StatusBadge tone="bad">Atrasado</StatusBadge> : null}
          </span>
        }
        actions={
          canWrite && isOrderEditable(order.status) ? (
            <Button asChild variant="outline">
              <Link href={`/pedidos/${order.id}/editar`}>
                <Pencil /> Editar ítems
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="grid content-start gap-4">
          {canMove && next.length > 0 ? <StatusActions orderId={order.id} next={next} /> : null}

          {estimate && (estimate.needsProduction || estimate.capacityShare.exceeds) ? (
            <EstimateCard
              estimate={estimate}
              promisedDate={order.promisedDate}
              useDateAction={
                canWrite && estimate.date ? <UseDateButton orderId={order.id} date={estimate.date} /> : null
              }
            />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Productos</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Cant.</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Precio</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        {i.product.name}
                        <div className="text-muted-foreground text-xs">
                          <Kg value={i.qtyUnits * i.product.netWeightKg} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{i.qtyUnits}</TableCell>
                      <TableCell className="hidden text-right sm:table-cell">
                        <Money value={i.unitPrice} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={i.qtyUnits * i.unitPrice} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={2}>
                      Total · <Kg value={kg} />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell" />
                    <TableCell
                      className="text-right text-base font-semibold"
                      data-testid="order-detail-total"
                    >
                      <Money value={order.total} />
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Datos</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Entrega</dt>
                <dd>
                  <DateText value={order.promisedDate} />
                </dd>
                <dt className="text-muted-foreground">Origen</dt>
                <dd>{ORDER_SOURCE[order.source] ?? order.source}</dd>
                <dt className="text-muted-foreground">Recibido</dt>
                <dd>{formatDateTimeAR(order.receivedAt)}</dd>
                {order.deliveredAt ? (
                  <>
                    <dt className="text-muted-foreground">Entregado</dt>
                    <dd>{formatDateTimeAR(order.deliveredAt)}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Lista</dt>
                <dd>{order.priceList?.name ?? "—"}</dd>
                <dt className="text-muted-foreground">Cargó</dt>
                <dd>{order.createdBy?.name ?? "—"}</dd>
                {order.notes ? (
                  <>
                    <dt className="text-muted-foreground">Notas</dt>
                    <dd>{order.notes}</dd>
                  </>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Historial</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-3" data-testid="order-events">
                {order.events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge tone={ORDER_STATUS[e.status]?.tone}>
                        {ORDER_STATUS[e.status]?.label}
                      </StatusBadge>
                      <span className="text-muted-foreground text-xs">{formatDateTimeAR(e.at)}</span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {e.by?.name ?? "Sistema"}
                      {e.note ? ` · ${e.note}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
