import Link from "next/link";
import type { Route } from "next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText, Money } from "@/components/app/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { todayAR } from "@/lib/dates";
import { DispatchTabs } from "@/features/dispatch/components/dispatch-tabs-server";
import { SETTLEMENT_STATUS } from "@/features/dispatch/components/settlement-panel";
import { monthLabel, monthOf } from "@/features/dispatch/labels";
import { monthRange } from "@/features/dispatch/service";
import { listSettlements, routesPendingSettlement } from "@/features/dispatch/settlement";

export const metadata = { title: "Despacho · Rendiciones" };

/**
 * Rendiciones del chofer: lo que entregó contra lo que el sistema registró como cobrado en cada ruta.
 * Permiso `dispatch:settle` (Dirección y jefa): son quienes reciben el efectivo y los cheques; el chofer
 * rinde desde su ruta pero no ve el listado de los demás.
 */
export default async function SettlementsPage(props: PageProps<"/despacho/rendiciones">) {
  await requirePermission("dispatch:settle");
  const { mes } = await props.searchParams;
  const month = typeof mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? mes : monthOf(todayAR());
  const range = monthRange(month);
  const [rows, pending] = await Promise.all([listSettlements(db, range), routesPendingSettlement(db, range)]);
  const withDiff = rows.filter((r) => r.status !== "ok");
  const missing = rows.reduce((a, r) => a + Math.min(0, r.cashDiff), 0);
  const unreceived = rows.filter((r) => !r.receivedByName).length;
  const prev = monthOf(addMonths(`${month}-01`, -1));
  const next = monthOf(addMonths(`${month}-01`, 1));

  return (
    <>
      <PageHeader
        title="Despacho y reparto"
        description="Hojas de ruta, remitos con lote, salida del vehículo y costo del reparto (RF-24 a RF-28)."
      />
      <DispatchTabs />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="icon" aria-label="Mes anterior">
          <Link href={`/despacho/rendiciones?mes=${prev}` as Route}>
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
          <Link href={`/despacho/rendiciones?mes=${next}` as Route}>
            <ChevronRight />
          </Link>
        </Button>
        <p className="text-muted-foreground ml-1 text-sm">{monthLabel(month)}</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Rendiciones del mes" value={rows.length} testId="sum-settlements" />
        <StatCard
          title="Con diferencia"
          value={withDiff.length}
          tone={withDiff.length ? "bad" : "good"}
          testId="sum-diff"
        />
        <StatCard
          title="Efectivo faltante"
          value={<Money value={Math.abs(missing)} />}
          tone={missing < 0 ? "bad" : "good"}
          testId="sum-missing"
        />
        <StatCard
          title="Sin recibir ni rendir"
          value={unreceived + pending.length}
          tone={unreceived + pending.length ? "warn" : "good"}
          hint={`${pending.length} ruta(s) sin rendir`}
          testId="sum-open"
        />
      </div>

      {pending.length ? (
        <section className="mb-6" aria-label="Rutas sin rendir">
          <h2 className="mb-2 text-sm font-semibold">Rutas cerradas sin rendir</h2>
          <ul className="grid gap-2">
            {pending.map((p) => (
              <li
                key={p.routeId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-500 bg-amber-50 p-3 text-sm dark:bg-amber-950/30"
                data-testid="pending-settlement"
              >
                <Link href={`/despacho/rutas/${p.routeId}` as Route} className="font-medium hover:underline">
                  Ruta del <DateText value={p.date} />
                </Link>
                <span>{p.driverName ?? "Sin chofer"}</span>
                <span>
                  Cobró <Money value={p.collected} /> en {p.payments} {p.payments === 1 ? "cobro" : "cobros"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No hay rendiciones en este mes"
          description="El chofer rinde lo cobrado desde su ruta, al cerrarla."
        />
      ) : (
        <div className="rounded-lg border">
          <Table aria-label="Rendiciones del chofer">
            <TableHeader>
              <TableRow>
                <TableHead>Ruta</TableHead>
                <TableHead>Chofer</TableHead>
                <TableHead className="text-right">Efectivo cobrado</TableHead>
                <TableHead className="text-right">Efectivo entregado</TableHead>
                <TableHead className="text-right">Cheques (entregó / cobró)</TableHead>
                <TableHead>Diferencia</TableHead>
                <TableHead>Recibida</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const st = SETTLEMENT_STATUS[r.status];
                return (
                  <TableRow key={r.id} data-testid="settlement-row" data-status={r.status}>
                    <TableCell>
                      <Link
                        href={`/despacho/rutas/${r.routeId}` as Route}
                        className="font-medium hover:underline"
                      >
                        <DateText value={r.routeDate} />
                      </Link>
                    </TableCell>
                    <TableCell>{r.driverName ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Money value={r.cashExpected} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={r.cashDelivered} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.checksDelivered} / {r.checksExpected}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                      {r.status !== "ok" ? (
                        <span className="mt-1 block text-xs tabular-nums">
                          {r.cashDiff !== 0 ? (
                            <>
                              Efectivo {r.cashDiff > 0 ? "+" : "−"}
                              <Money value={Math.abs(r.cashDiff)} />
                            </>
                          ) : null}
                          {r.checksDiff !== 0
                            ? ` Cheques ${r.checksDiff > 0 ? "+" : "−"}${Math.abs(r.checksDiff)}`
                            : ""}
                        </span>
                      ) : null}
                      {r.notes ? (
                        <span className="text-muted-foreground mt-1 block text-xs">{r.notes}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {r.receivedByName ? (
                        r.receivedByName
                      ) : (
                        <Link
                          href={`/despacho/rutas/${r.routeId}` as Route}
                          className="text-sm font-medium underline"
                        >
                          Pendiente: abrir y recibir
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
