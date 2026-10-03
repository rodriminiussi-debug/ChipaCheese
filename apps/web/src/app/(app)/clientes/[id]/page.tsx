import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { DateText, Money, Num } from "@/components/app/format";
import { Button } from "@/components/ui/button";
import { OrdersTable } from "@/features/orders/components/orders-table";
import { customerOrderStats, listCustomerOrders } from "@/features/orders/service";
import { todayAR } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { customerFormOptions, getCustomer } from "@/features/customers/service";
import { CustomerForm } from "@/features/customers/components/customer-form";
import { can } from "@/lib/rbac";
import { CHANNEL } from "@/lib/labels";

export default async function CustomerPage(props: PageProps<"/clientes/[id]">) {
  const user = await requirePermission("customers:read");
  const { id } = await props.params;
  const [customer, options] = await Promise.all([getCustomer(db, id), customerFormOptions(db)]);
  if (!customer) notFound();
  const editable = can(user.role, "customers:write");
  const showOrders = can(user.role, "orders:read");
  const [stats, orders] = showOrders
    ? await Promise.all([customerOrderStats(db, id, todayAR()), listCustomerOrders(db, id)])
    : [null, []];

  return (
    <>
      <PageHeader
        title={customer.legalName}
        description={`${CHANNEL[customer.channel]} · ${customer.zone?.name ?? "sin zona"}`}
        actions={
          can(user.role, "orders:write") && customer.active ? (
            <Button asChild>
              <Link href={`/pedidos/nuevo?cliente=${customer.id}`}>
                <Plus /> Nuevo pedido
              </Link>
            </Button>
          ) : null
        }
      />
      {stats ? (
        <section aria-label="Historial de compras" className="mb-8 grid gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              title="Frecuencia de compra"
              value={
                stats.averageIntervalDays != null ? (
                  <Num value={stats.averageIntervalDays} decimals={0} suffix="días" />
                ) : (
                  "—"
                )
              }
              hint={stats.averageIntervalDays != null ? "Promedio entre pedidos" : "Necesita 2 pedidos o más"}
            />
            <StatCard
              title="Sin pedir hace"
              value={stats.daysSinceLastOrder != null ? `${stats.daysSinceLastOrder} días` : "—"}
              tone={stats.overdue ? "bad" : "default"}
              hint={
                stats.overdue ? (
                  "Para llamar: superó su frecuencia habitual"
                ) : stats.lastOrderDate ? (
                  <>
                    Último pedido <DateText value={stats.lastOrderDate} />
                  </>
                ) : (
                  "Todavía no pidió"
                )
              }
            />
            <StatCard
              title="Comprado (90 días)"
              value={<Money value={stats.last90Total} />}
              hint={`${stats.last90Orders} pedidos · ${Math.round(stats.last90Kg)} kg`}
            />
            <StatCard
              title="Próximo pedido esperado"
              value={stats.expectedNextDate ? <DateText value={stats.expectedNextDate} /> : "—"}
              hint="Último pedido + frecuencia"
            />
          </div>
          <h2 className="text-lg font-semibold">Pedidos</h2>
          {orders.length === 0 ? (
            <p className="text-muted-foreground text-sm">Todavía no tiene pedidos.</p>
          ) : (
            <OrdersTable rows={orders} showCustomer={false} />
          )}
        </section>
      ) : null}
      {editable ? (
        <CustomerForm
          options={options}
          initial={{
            id: customer.id,
            legalName: customer.legalName,
            tradeName: customer.tradeName ?? "",
            cuit: customer.cuit ?? "",
            channel: customer.channel,
            priceListId: customer.priceListId,
            zoneId: customer.zoneId,
            deliveryWeekdays: customer.deliveryWeekdays,
            paymentTermsDays: customer.paymentTermsDays,
            paymentNotes: customer.paymentNotes ?? "",
            whatsapp: customer.whatsapp ?? "",
            address: customer.address ?? "",
            notes: customer.notes ?? "",
            active: customer.active,
          }}
        />
      ) : null}
    </>
  );
}
