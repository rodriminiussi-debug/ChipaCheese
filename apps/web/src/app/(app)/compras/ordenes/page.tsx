import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText } from "@/components/app/format";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { DeliveryTable } from "@/features/purchases/components/delivery-table";
import { expectedDeliveries, listOrders } from "@/features/purchases/service";
import { PO_STATUS } from "@/features/purchases/labels";
import { can } from "@/lib/rbac";
import { todayAR } from "@/lib/dates";

export const metadata = { title: "Órdenes de compra" };

export default async function OrdersPage() {
  const user = await requirePermission("purchases:read");
  const today = todayAR();
  const [deliveries, orders] = await Promise.all([expectedDeliveries(db, today), listOrders(db)]);
  const overdue = deliveries.filter((d) => d.timing.state === "overdue");
  const upcoming = deliveries.filter((d) => d.timing.state !== "overdue");

  return (
    <>
      <PageHeader
        title="Órdenes de compra"
        description="Pedidos a proveedores con fecha esperada y responsable; un solo canal (WhatsApp) con cada uno (RF-10)."
        actions={
          can(user.role, "purchases:write") ? (
            <Button asChild>
              <Link href="/compras/ordenes/nueva">
                <Plus /> Nueva orden
              </Link>
            </Button>
          ) : null
        }
      />
      <h2 className="sr-only">Entregas esperadas</h2>
      <DeliveryTable rows={overdue} title="Entregas atrasadas" tone="bad" />
      <DeliveryTable rows={upcoming} title="Próximas entregas" tone="info" />

      <section>
        <h2 className="mb-2 text-lg font-semibold">Todas las órdenes</h2>
        {orders.length === 0 ? (
          <EmptyState title="Todavía no hay órdenes de compra" />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Orden</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead className="hidden sm:table-cell">Pedida</TableHead>
                  <TableHead className="hidden sm:table-cell">Esperada</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Link href={`/compras/ordenes/${o.id}`} className="font-medium hover:underline">
                        {o.number}
                      </Link>
                    </TableCell>
                    <TableCell>{o.supplier.legalName}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <DateText value={o.orderedAt} />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <DateText value={o.expectedAt} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={PO_STATUS[o.status]!.tone}>{PO_STATUS[o.status]!.label}</StatusBadge>
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
