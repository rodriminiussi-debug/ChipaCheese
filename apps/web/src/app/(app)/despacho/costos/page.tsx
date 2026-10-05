import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, SMALL_ROUTE_KG } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText, Kg, Money, Num } from "@/components/app/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { todayAR } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { DispatchTabs } from "@/features/dispatch/components/dispatch-tabs-server";
import {
  costByMonth,
  costByZone,
  listRouteCosts,
  monthRange,
  summarizeCosts,
} from "@/features/dispatch/service";
import { monthLabel, monthOf } from "@/features/dispatch/labels";

export const metadata = { title: "Despacho · Costo de reparto" };

/**
 * RF-27: costo por ruta y por kg entregado. Costo = combustible (real o km × costo por km) +
 * horas × costo horario del chofer + otros costos. Resalta las rutas chicas (menos de 50 kg).
 */
export default async function DeliveryCostPage(props: PageProps<"/despacho/costos">) {
  await requirePermission("dispatch:read");
  const { mes } = await props.searchParams;
  const month = typeof mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? mes : monthOf(todayAR());
  const [rows, byZone, byMonth] = await Promise.all([
    listRouteCosts(db, monthRange(month)),
    costByZone(db, month),
    costByMonth(db, month, 6),
  ]);
  const summary = summarizeCosts(rows);
  const prev = monthOf(addMonths(`${month}-01`, -1));
  const next = monthOf(addMonths(`${month}-01`, 1));
  const small = rows.filter((r) => r.small).length;
  const partial = rows.filter((r) => r.partial).length;

  return (
    <>
      <PageHeader
        title="Despacho y reparto"
        description="Hojas de ruta, remitos con lote, salida del vehículo y costo del reparto (RF-24 a RF-28)."
      />
      <DispatchTabs />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="icon" aria-label="Mes anterior">
          <Link href={`/despacho/costos?mes=${prev}`}>
            <ChevronLeft />
          </Link>
        </Button>
        <form className="flex gap-2">
          <Input type="month" name="mes" defaultValue={month} aria-label="Mes" className="w-44" />
          <Button type="submit" variant="outline">
            Ver
          </Button>
        </form>
        <Button asChild variant="outline" size="icon" aria-label="Mes siguiente">
          <Link href={`/despacho/costos?mes=${next}`}>
            <ChevronRight />
          </Link>
        </Button>
        <p className="text-muted-foreground ml-1 text-sm capitalize">{monthLabel(month)}</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6" data-testid="cost-summary">
        <StatCard title="Rutas cerradas" value={summary.routes} testId="sum-routes" />
        <StatCard title="Km recorridos" value={<Num value={summary.km} decimals={0} />} testId="sum-km" />
        <StatCard title="Horas" value={<Num value={summary.hours} decimals={1} />} testId="sum-hours" />
        <StatCard title="Kg entregados" value={<Kg value={summary.kg} />} testId="sum-kg" />
        <StatCard title="Costo total" value={<Money value={summary.cost} />} testId="sum-cost" />
        <StatCard
          title="Costo por kg"
          value={<Money value={summary.costPerKg} />}
          tone={summary.costPerKg == null ? "default" : "good"}
          hint="Costo ÷ kg entregados"
          testId="sum-cost-kg"
        />
      </div>

      {small > 0 ? (
        <p
          role="status"
          className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40"
        >
          {small === 1 ? "1 ruta salió" : `${small} rutas salieron`} con menos de {SMALL_ROUTE_KG} kg: el
          costo por kg se dispara. Conviene juntar pedidos o fijar días de reparto por zona.
        </p>
      ) : null}

      {partial > 0 ? (
        <p
          role="status"
          data-testid="partial-warning"
          className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40"
        >
          {partial === 1 ? "1 ruta tiene" : `${partial} rutas tienen`} costo parcial: falta el costo por km
          del vehículo o el costo hora del chofer, así que el total y el costo por kg quedan por debajo del
          real. Completá el dato en el vehículo (costo por km) o en la configuración (costo hora del chofer).
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No hay rutas cerradas en este mes"
          description="Los costos se calculan cuando el chofer cierra la ruta con km final, combustible y horas."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ruta</TableHead>
                <TableHead className="hidden lg:table-cell">Chofer y vehículo</TableHead>
                <TableHead className="text-right">Km</TableHead>
                <TableHead className="text-right">Horas</TableHead>
                <TableHead className="text-right">Kg</TableHead>
                <TableHead className="hidden text-right xl:table-cell">Combustible</TableHead>
                <TableHead className="hidden text-right xl:table-cell">Chofer</TableHead>
                <TableHead className="hidden text-right xl:table-cell">Otros</TableHead>
                <TableHead className="text-right">Costo</TableHead>
                <TableHead className="text-right">$/kg</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  data-testid="cost-row"
                  data-small={r.small}
                  className={cn(r.small && "bg-amber-50 dark:bg-amber-950/30")}
                >
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <Link href={`/despacho/rutas/${r.id}`} className="font-medium hover:underline">
                        <DateText value={r.date} />
                      </Link>
                      {r.small ? <StatusBadge tone="warn">Ruta chica</StatusBadge> : null}
                      {r.partial ? (
                        <span
                          title={r.missing
                            .map((m) =>
                              m === "vehicle_cost_per_km"
                                ? "Falta el costo por km del vehículo"
                                : "Falta el costo hora del chofer",
                            )
                            .join(". ")}
                        >
                          <StatusBadge tone="warn">Costo parcial</StatusBadge>
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {r.driverName ?? "—"} · {r.vehicleName ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Num value={r.km} decimals={0} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Num value={r.hours} decimals={1} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Kg value={r.kg} />
                  </TableCell>
                  <TableCell className="hidden text-right xl:table-cell">
                    <Money value={r.fuel} />
                  </TableCell>
                  <TableCell className="hidden text-right xl:table-cell">
                    <Money value={r.labor} />
                  </TableCell>
                  <TableCell className="hidden text-right xl:table-cell">
                    <Money value={r.other} />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <Money value={r.cost} />
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    <Money value={r.costPerKg} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <section className="mt-8 grid gap-3" aria-labelledby="costo-zona">
        <h2 id="costo-zona" className="text-lg font-semibold">
          Por zona · <span className="capitalize">{monthLabel(month)}</span>
        </h2>
        {byZone.zones.length === 0 ? (
          <p className="text-muted-foreground text-sm">No hay entregas en rutas cerradas este mes.</p>
        ) : (
          <div className="rounded-lg border">
            <Table aria-label="Costo de reparto por zona">
              <TableHeader>
                <TableRow>
                  <TableHead>Zona</TableHead>
                  <TableHead className="text-right">Rutas</TableHead>
                  <TableHead className="text-right">Entregas</TableHead>
                  <TableHead className="text-right">Kg</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead className="text-right">$/kg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byZone.zones.map((z) => (
                  <TableRow key={z.zoneId ?? "none"}>
                    <TableCell>
                      <span className="font-medium">{z.zone}</span>{" "}
                      {z.partial ? <StatusBadge tone="warn">Costo parcial</StatusBadge> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{z.routes}</TableCell>
                    <TableCell className="text-right tabular-nums">{z.deliveries}</TableCell>
                    <TableCell className="text-right">
                      <Kg value={z.kg} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={z.cost} />
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      <Money value={z.costPerKg} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {byZone.unallocatedRoutes > 0 ? (
          <p className="text-muted-foreground text-xs">
            {byZone.unallocatedRoutes} {byZone.unallocatedRoutes === 1 ? "ruta cerrada" : "rutas cerradas"}{" "}
            sin entregas ({<Money value={byZone.unallocatedCost} />}) no se reparten entre zonas. El costo de
            cada ruta se reparte entre las zonas según los kg entregados en cada una.
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            El costo de cada ruta se reparte entre las zonas según los kg entregados en cada una.
          </p>
        )}
      </section>

      <section className="mt-8 grid gap-3" aria-labelledby="costo-mes">
        <h2 id="costo-mes" className="text-lg font-semibold">
          Por mes
        </h2>
        <div className="rounded-lg border">
          <Table aria-label="Costo de reparto por mes">
            <TableHeader>
              <TableRow>
                <TableHead>Mes</TableHead>
                <TableHead className="text-right">Rutas</TableHead>
                <TableHead className="text-right">Km</TableHead>
                <TableHead className="text-right">Kg</TableHead>
                <TableHead className="text-right">Costo</TableHead>
                <TableHead className="text-right">$/kg</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...byMonth].reverse().map((m) => (
                <TableRow key={m.month} className={cn(m.month === month && "bg-muted/50")}>
                  <TableCell className="capitalize">
                    <Link href={`/despacho/costos?mes=${m.month}`} className="hover:underline">
                      {monthLabel(m.month)}
                    </Link>{" "}
                    {m.partialRoutes > 0 ? <StatusBadge tone="warn">Costo parcial</StatusBadge> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m.routes}</TableCell>
                  <TableCell className="text-right">
                    <Num value={m.km} decimals={0} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Kg value={m.kg} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={m.cost} />
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    <Money value={m.costPerKg} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <p className="text-muted-foreground mt-3 text-xs">
        Los kg son los de los remitos entregados. Si no se cargó el gasto de combustible, se estima con el
        costo por km del vehículo; el costo horario del chofer es un parámetro del negocio.
      </p>
    </>
  );
}
