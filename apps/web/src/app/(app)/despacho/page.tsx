import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, Printer, Truck } from "lucide-react";
import { addDays } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { Kg } from "@/components/app/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { can } from "@/lib/rbac";
import { todayAR } from "@/lib/dates";
import { DispatchTabs } from "@/features/dispatch/components/dispatch-tabs";
import { listRoutes, readyOrdersWithoutRoute, type RouteSummary } from "@/features/dispatch/service";
import { ROUTE_STATUS, weekdayDate } from "@/features/dispatch/labels";

export const metadata = { title: "Despacho y reparto" };

function RouteCard({ r }: { r: RouteSummary }) {
  const st = ROUTE_STATUS[r.status];
  return (
    <Card data-testid="route-card">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/despacho/rutas/${r.id}`} className="font-semibold hover:underline">
              Ruta del {weekdayDate(r.date)}
            </Link>
            <StatusBadge tone={st?.tone}>{st?.label}</StatusBadge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {r.deliveries} {r.deliveries === 1 ? "entrega" : "entregas"}
            {r.pickups
              ? ` · ${r.pickups} ${r.pickups === 1 ? "retiro" : "retiros"} en proveedores`
              : ""} · {r.stopsDone}/{r.deliveries + r.pickups} hechas · <Kg value={r.kg} /> · {r.units} bultos
          </p>
          <p className="text-muted-foreground text-sm">
            {r.driverName ?? "Sin chofer"} ·{" "}
            {r.vehicleName ? `${r.vehicleName} (${r.plate})` : "Sin vehículo"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href={`/despacho/rutas/${r.id}`}>
              <Truck /> Abrir ruta
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/despacho/rutas/${r.id}/hoja`}>
              <Printer /> Hoja de ruta
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** RF-24: rutas por fecha. Desde acá se arma la ruta del día y se abre la vista del chofer. */
export default async function DispatchPage(props: PageProps<"/despacho">) {
  const user = await requirePermission("dispatch:read");
  const { fecha } = await props.searchParams;
  const today = todayAR();
  const date = typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : today;
  const [routes, upcoming, readyWithoutRoute] = await Promise.all([
    listRoutes(db, { from: date, to: date }),
    listRoutes(db, { from: addDays(date, 1), to: addDays(date, 7) }),
    readyOrdersWithoutRoute(db),
  ]);
  const canWrite = can(user.role, "dispatch:write");
  const kg = routes.reduce((a, r) => a + r.kg, 0);

  return (
    <>
      <PageHeader
        title="Despacho y reparto"
        description="Hojas de ruta, remitos con lote, salida del vehículo y costo del reparto (RF-24 a RF-28)."
        actions={
          canWrite ? (
            <Button asChild>
              <Link href={`/despacho/nueva?fecha=${date}`}>
                <Plus /> Nueva ruta
              </Link>
            </Button>
          ) : null
        }
      />
      <DispatchTabs />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="icon" aria-label="Día anterior">
          <Link href={`/despacho?fecha=${addDays(date, -1)}`}>
            <ChevronLeft />
          </Link>
        </Button>
        <form className="flex gap-2">
          <Input type="date" name="fecha" defaultValue={date} aria-label="Fecha" className="w-40" />
          <Button type="submit" variant="outline">
            Ver
          </Button>
        </form>
        <Button asChild variant="outline" size="icon" aria-label="Día siguiente">
          <Link href={`/despacho?fecha=${addDays(date, 1)}`}>
            <ChevronRight />
          </Link>
        </Button>
        {date !== today ? (
          <Button asChild variant="ghost">
            <Link href="/despacho">Hoy</Link>
          </Button>
        ) : null}
        <p className="text-muted-foreground ml-1 text-sm" data-testid="route-date">
          {weekdayDate(date)}
        </p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard title="Rutas del día" value={routes.length} />
        <StatCard title="Peso a repartir" value={<Kg value={kg} />} />
        <StatCard
          title="Pedidos listos sin ruta"
          value={readyWithoutRoute}
          tone={readyWithoutRoute ? "warn" : "default"}
          hint="En todas las fechas"
        />
      </div>

      {routes.length === 0 ? (
        <EmptyState
          title="No hay rutas para este día"
          description="Armá la ruta desde los pedidos listos, agrupados por zona."
          action={
            canWrite ? (
              <Button asChild>
                <Link href={`/despacho/nueva?fecha=${date}`}>
                  <Plus /> Armar la ruta del día
                </Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-3">
          {routes.map((r) => (
            <RouteCard key={r.id} r={r} />
          ))}
        </div>
      )}

      {upcoming.length ? (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">Próximos 7 días</h2>
          <div className="grid gap-3">
            {upcoming.map((r) => (
              <RouteCard key={r.id} r={r} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
