import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText, Money, Num } from "@/components/app/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getOrder } from "@/features/purchases/service";
import { orderWhatsappUrl } from "@/features/purchases/order-message";
import { OrderActions } from "@/features/purchases/components/order-actions";
import { PO_STATUS } from "@/features/purchases/labels";
import { can } from "@/lib/rbac";
import { UNIT } from "@/lib/labels";

export default async function OrderPage(props: PageProps<"/compras/ordenes/[id]">) {
  const user = await requirePermission("purchases:read");
  const { id } = await props.params;
  const order = await getOrder(db, id);
  if (!order) notFound();
  const status = PO_STATUS[order.status]!;
  const whatsappUrl = orderWhatsappUrl(
    {
      number: order.number,
      supplierName: order.supplier.tradeName ?? order.supplier.legalName,
      expectedAt: order.expectedAt,
      items: order.items.map((i) => ({ name: i.ingredient.name, qty: i.qty, unit: i.unit })),
    },
    order.supplier.whatsapp,
  );
  const estimated = order.items.reduce((a, i) => a + i.qty * (i.estimatedUnitPrice ?? 0), 0);

  return (
    <>
      <PageHeader
        title={order.number}
        description={
          <>
            <Link href={`/proveedores/${order.supplierId}`} className="hover:underline">
              {order.supplier.legalName}
            </Link>{" "}
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            {order.pickup ? (
              <StatusBadge tone="info" className="ml-1">
                Retiro en proveedor
              </StatusBadge>
            ) : null}
          </>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/compras/ordenes/${order.id}/imprimir`}>
                <Printer /> Imprimir / PDF
              </Link>
            </Button>
            {can(user.role, "purchases:write") ? (
              <OrderActions orderId={order.id} status={order.status} whatsappUrl={whatsappUrl} />
            ) : null}
          </>
        }
      />
      <dl className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["Pedida", <DateText key="o" value={order.orderedAt} />],
            ["Entrega esperada", <DateText key="e" value={order.expectedAt} />],
            ["Responsable", order.responsible?.name ?? "—"],
            ["Importe estimado (neto)", <Money key="m" value={estimated} />],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Insumo</TableHead>
              <TableHead className="text-right">Pedido</TableHead>
              <TableHead className="text-right">Recibido</TableHead>
              <TableHead className="text-right">Precio estimado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.ingredient.name}</TableCell>
                <TableCell className="text-right">
                  <Num value={i.qty} decimals={Number.isInteger(i.qty) ? 0 : 3} suffix={UNIT[i.unit]} />
                </TableCell>
                <TableCell className="text-right">
                  <Num
                    value={i.received}
                    decimals={Number.isInteger(i.received) ? 0 : 3}
                    suffix={UNIT[i.unit]}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={i.estimatedUnitPrice} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {order.notes ? <p className="text-muted-foreground mt-4 text-sm">{order.notes}</p> : null}
    </>
  );
}
