import Link from "next/link";
import { notFound } from "next/navigation";
import type { Route } from "next";
import { ChevronLeft, Printer, Wallet, Wrench } from "lucide-react";
import { routeHours } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { EmptyState } from "@/components/app/empty-state";
import { Kg } from "@/components/app/format";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { can } from "@/lib/rbac";
import {
  AddSupplierStop,
  GenerateAllDispatches,
  RouteAssign,
  RouteRunPanel,
} from "@/features/dispatch/components/route-panels";
import { StopCard } from "@/features/dispatch/components/stop-card";
import { dispatchFormOptions, getRoute, lastKmEnd } from "@/features/dispatch/service";
import { ROUTE_STATUS, weekdayDate } from "@/features/dispatch/labels";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function generateMetadata(props: PageProps<"/despacho/rutas/[id]">) {
  const { id } = await props.params;
  const route = UUID.test(id) ? await getRoute(db, id) : null;
  return { title: route ? `Ruta del ${weekdayDate(route.date)}` : "Ruta" };
}

/**
 * Vista de la ruta: pensada para el celular del chofer (paradas, Google Maps, remito, entrega,
 * salida del vehículo) y, con permiso de escritura, también para armarla y ordenarla (RF-24 a RF-26).
 */
export default async function RoutePage(props: PageProps<"/despacho/rutas/[id]">) {
  const user = await requirePermission("dispatch:read");
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();
  const route = await getRoute(db, id);
  if (!route) notFound();

  const canWrite = can(user.role, "dispatch:write");
  const open = route.status === "planned" || route.status === "in_progress";
  const [options, suggestedKmStart] = await Promise.all([
    canWrite && open ? dispatchFormOptions(db) : null,
    route.vehicleId && route.status === "planned" ? lastKmEnd(db, route.vehicleId) : null,
  ]);
  const st = ROUTE_STATUS[route.status];
  // Chofer y vehículo van arriba solo si falta alguno; si no, después de las paradas.
  const assignFirst = !route.vehicleId || !route.driverId;
  const deliveries = route.stops.filter((s) => s.kind === "delivery").length;
  const pickups = route.stops.length - deliveries;
  const withoutDispatch = route.stops.filter(
    (s) =>
      s.kind === "delivery" &&
      (s.orderStatus === "ready" || s.orderStatus === "dispatched") &&
      !(s.dispatch && s.dispatch.status !== "rejected"),
  ).length;

  const runRoute = {
    id: route.id,
    status: route.status,
    vehicleName: route.vehicle?.name ?? null,
    hasColdUnit: route.vehicle?.hasColdUnit ?? true,
    kmStart: route.kmStart,
    kmEnd: route.kmEnd,
    startedAt: route.startedAt?.toISOString() ?? null,
    endedAt: route.endedAt?.toISOString() ?? null,
    fuelLiters: route.fuelLiters,
    fuelCost: route.fuelCost,
    otherCosts: route.otherCosts,
    coldUnitTempC: route.coldUnitTempC,
    suggestedKmStart,
    pendingDispatches: route.totals.pendingDispatches,
    hours: route.startedAt && route.endedAt ? routeHours(route.startedAt, route.endedAt) : null,
  };

  return (
    <>
      <PageHeader
        title={`Ruta del ${weekdayDate(route.date)}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/despacho?fecha=${route.date}`} className="inline-flex items-center hover:underline">
              <ChevronLeft className="size-4" /> Rutas
            </Link>
            <StatusBadge tone={st?.tone}>{st?.label}</StatusBadge>
            <span>
              {route.driver?.name ?? "Sin chofer"} ·{" "}
              {route.vehicle ? `${route.vehicle.name} (${route.vehicle.plate})` : "Sin vehículo"}
            </span>
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline" className="h-11">
              <Link href={`/despacho/rutas/${route.id}/hoja`}>
                <Printer /> Hoja de ruta
              </Link>
            </Button>
            {can(user.role, "maintenance:report") ? (
              <Button asChild variant="outline" className="h-11">
                <Link
                  href={
                    `/avisar-falla?volver=/despacho/rutas/${route.id}${route.vehicle?.equipmentId ? `&equipo=${route.vehicle.equipmentId}` : ""}` as Route
                  }
                >
                  <Wrench /> Avisar una falla
                </Link>
              </Button>
            ) : null}
            {can(user.role, "collections:write") ? (
              <Button asChild variant="outline" className="h-11">
                <Link href={`/cobranzas/ruta/${route.id}` as Route}>
                  <Wallet /> Cobros
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <p className="text-muted-foreground mb-4 text-sm" data-testid="route-summary">
        {deliveries} {deliveries === 1 ? "entrega" : "entregas"}
        {pickups ? ` · ${pickups} ${pickups === 1 ? "retiro" : "retiros"} en proveedores` : ""} ·{" "}
        <Kg value={route.totals.kg} /> · {route.totals.units} bultos · {route.totals.stopsDone}/
        {route.totals.stops} paradas hechas
      </p>
      {route.notes ? <p className="bg-muted mb-4 rounded-md p-3 text-sm">{route.notes}</p> : null}

      <div className="grid gap-4">
        {options && assignFirst ? (
          <RouteAssign
            routeId={route.id}
            driverId={route.driverId}
            vehicleId={route.vehicleId}
            notes={route.notes}
            options={options}
          />
        ) : null}

        {route.status !== "in_progress" ? <RouteRunPanel route={runRoute} canWrite={canWrite} /> : null}

        {canWrite && open && withoutDispatch > 0 ? (
          <div>
            <GenerateAllDispatches routeId={route.id} pending={withoutDispatch} />
          </div>
        ) : null}

        <section className="grid gap-3" aria-label="Paradas">
          <h2 className="text-sm font-semibold">Paradas</h2>
          {route.stops.length === 0 ? (
            <EmptyState title="La ruta no tiene paradas" />
          ) : (
            route.stops.map((s, i) => (
              <StopCard
                key={s.id}
                stop={s}
                routeId={route.id}
                open={open}
                canWrite={canWrite}
                isFirst={i === 0}
                isLast={i === route.stops.length - 1}
                canViewOrders={can(user.role, "orders:read")}
              />
            ))
          )}
        </section>

        {/* En curso, el cierre va después de las paradas: se carga al volver. */}
        {route.status === "in_progress" ? <RouteRunPanel route={runRoute} canWrite={canWrite} /> : null}

        {options && open ? <AddSupplierStop routeId={route.id} suppliers={options.suppliers} /> : null}
        {options && !assignFirst ? (
          <RouteAssign
            routeId={route.id}
            driverId={route.driverId}
            vehicleId={route.vehicleId}
            notes={route.notes}
            options={options}
          />
        ) : null}
      </div>
    </>
  );
}
