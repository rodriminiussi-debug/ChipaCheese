import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { ORDER_STATUSES, type OrderStatus } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";
import { listCustomers } from "@/features/customers/service";
import { countOverdueOrders, getOverdueCustomers, listOrders } from "@/features/orders/service";
import type { OrderFilters } from "@/features/orders/schemas";
import { OrdersTable } from "@/features/orders/components/orders-table";
import { OverdueCustomers } from "@/features/orders/components/overdue-customers";
import { ORDER_STATUS } from "@/lib/labels";
import { todayAR } from "@/lib/dates";
import { can } from "@/lib/rbac";

export const metadata = { title: "Pedidos" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
const isDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const selectClass =
  "border-input bg-background h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export default async function OrdersPage(props: PageProps<"/pedidos">) {
  const user = await requirePermission("orders:read");
  const sp = await props.searchParams;
  const status = one(sp.estado);
  const filters: OrderFilters = {
    status: ORDER_STATUSES.includes(status as OrderStatus) ? (status as OrderStatus) : undefined,
    customerId: one(sp.cliente),
    from: isDate(one(sp.desde)),
    to: isDate(one(sp.hasta)),
    overdue: one(sp.atrasados) === "1" || undefined,
  };
  const today = todayAR();
  const canWrite = can(user.role, "orders:write");
  const showCalls = canWrite;

  const [rows, todayRows, customers, overdueCount, toCall, factor] = await Promise.all([
    listOrders(db, filters, today),
    listOrders(db, { from: today, to: today }, today),
    can(user.role, "customers:read") ? listCustomers(db) : Promise.resolve([]),
    countOverdueOrders(db, today),
    showCalls ? getOverdueCustomers(db, today) : Promise.resolve([]),
    getSetting("orders.overdue_factor", 1.5),
  ]);
  const filtered = Object.values(filters).some((v) => v !== undefined);

  return (
    <>
      <PageHeader
        title="Pedidos"
        description="Todos los pedidos en un solo lugar, con estado y fecha comprometida."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/pedidos/envasado">Hoja de envasado</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/pedidos/fecha-posible">¿Para cuándo?</Link>
            </Button>
            {canWrite ? (
              <Button asChild>
                <Link href="/pedidos/nuevo">
                  <Plus /> Nuevo pedido
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 grid-cols-1 gap-4">
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              title="Atrasados"
              value={overdueCount}
              tone={overdueCount > 0 ? "bad" : "good"}
              hint={
                <Link href="/pedidos?atrasados=1" className="underline">
                  Ver atrasados
                </Link>
              }
            />
            <StatCard
              title="Para hoy"
              value={todayRows.filter((r) => r.status !== "cancelled").length}
              hint="Con fecha comprometida hoy"
            />
          </div>

          <form className="grid grid-cols-2 gap-2 rounded-lg border p-3 lg:grid-cols-3" aria-label="Filtros">
            <label className="grid gap-1 text-xs font-medium">
              Estado
              <select name="estado" defaultValue={filters.status ?? ""} className={selectClass}>
                <option value="">Todos</option>
                {ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ORDER_STATUS[s]?.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium">
              Cliente
              <select name="cliente" defaultValue={filters.customerId ?? ""} className={selectClass}>
                <option value="">Todos</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.legalName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium">
              Entrega desde
              <Input type="date" name="desde" defaultValue={filters.from} />
            </label>
            <label className="grid gap-1 text-xs font-medium">
              Entrega hasta
              <Input type="date" name="hasta" defaultValue={filters.to} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="atrasados" value="1" defaultChecked={!!filters.overdue} />
              Solo atrasados
            </label>
            <div className="flex items-end gap-2">
              <Button type="submit">Filtrar</Button>
              {filtered ? (
                <Button asChild variant="ghost">
                  <Link href="/pedidos">Limpiar</Link>
                </Button>
              ) : null}
            </div>
          </form>

          {rows.length === 0 ? (
            <EmptyState
              title="No hay pedidos"
              description={filtered ? "Probá con otros filtros." : "Cargá el primero."}
              action={
                canWrite && !filtered ? (
                  <Button asChild>
                    <Link href="/pedidos/nuevo">
                      <ClipboardList /> Nuevo pedido
                    </Link>
                  </Button>
                ) : null
              }
            />
          ) : (
            <OrdersTable rows={rows} />
          )}
        </div>

        {showCalls ? (
          <aside className={toCall.length > 0 ? "order-first min-w-0 lg:order-none" : "min-w-0"}>
            <OverdueCustomers customers={toCall} factor={factor} />
          </aside>
        ) : null}
      </div>
    </>
  );
}
