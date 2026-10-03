import Link from "next/link";
import { Plus } from "lucide-react";
import { addDays, assertIsoDate, formatDateAR, type IsoDate } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { DateText } from "@/components/app/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";
import { can } from "@/lib/rbac";
import { todayAR } from "@/lib/dates";
import { PlanEditor } from "@/features/production/components/plan-editor";
import { RunsTable } from "@/features/production/components/runs-table";
import { WeekPlan } from "@/features/production/components/week-plan";
import { fmtQty } from "@/features/production/format";
import { getPlan, listRecentLots, listRuns, suggestPlan, weekPlan } from "@/features/production/service";
import { ORDER_STATUS } from "@/lib/labels";

export const metadata = { title: "Producción" };

function validDate(v: unknown): IsoDate | null {
  if (typeof v !== "string") return null;
  try {
    assertIsoDate(v);
    return v;
  } catch {
    return null;
  }
}

export default async function ProductionPage(props: PageProps<"/produccion">) {
  const user = await requirePermission("production:read");
  const sp = await props.searchParams;
  const today = todayAR();
  const date = validDate(sp.fecha) ?? today;
  const days = Math.min(14, Math.max(0, Number(typeof sp.dias === "string" ? sp.dias : 3) || 3));
  const canWrite = can(user.role, "production:write");

  const [capacityKg, minBatchKg, workdays] = await Promise.all([
    getSetting("production.daily_capacity_kg", 150),
    getSetting("production.min_batch_kg", 75),
    getSetting<number[]>("production.workdays", [1, 2, 3, 4, 5]),
  ]);
  const [runs, lots, suggested, plan, week] = await Promise.all([
    listRuns(db, { limit: 10 }),
    listRecentLots(db, 6),
    suggestPlan(db, { date, windowDays: days, capacityKg, minBatchKg }),
    getPlan(db, date),
    weekPlan(db, date, workdays),
  ]);

  return (
    <>
      <PageHeader
        title="Producción"
        description="RF-19 a RF-22 · Plan del día y de la semana, producciones, consumos, pesadas y lotes."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/produccion/receta">Receta maestra</Link>
            </Button>
            {canWrite ? (
              <Button asChild>
                <Link href="/produccion/nueva">
                  <Plus /> Nueva producción
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6">
        <section aria-labelledby="producciones">
          <h2 id="producciones" className="mb-2 text-lg font-semibold">
            Producciones recientes
          </h2>
          {runs.length === 0 ? (
            <EmptyState title="Todavía no hay producciones" description="Creá la primera desde “Nueva producción”." />
          ) : (
            <RunsTable runs={runs} />
          )}
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Plan del día — {formatDateAR(date)}</CardTitle>
            <CardDescription>
              Pedidos recibidos, confirmados o en producción con entrega dentro de {days} días, menos el stock
              terminado, más el stock mínimo. Respeta el mínimo de {fmtQty(minBatchKg)} kg por tanda y los{" "}
              {fmtQty(capacityKg)} kg/día del abatidor.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form className="flex flex-wrap items-end gap-3" aria-label="Elegir día del plan">
              <label className="grid gap-1 text-sm">
                Fecha del plan
                <Input type="date" name="fecha" defaultValue={date} className="w-44" />
              </label>
              <label className="grid gap-1 text-sm">
                Pedidos de los próximos (días)
                <Input name="dias" type="number" min={0} max={14} defaultValue={days} className="w-28" />
              </label>
              <Button type="submit" variant="outline">
                Ver plan
              </Button>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/produccion?fecha=${addDays(date, -1)}&dias=${days}`}>← Día anterior</Link>
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/produccion?fecha=${addDays(date, 1)}&dias=${days}`}>Día siguiente →</Link>
                </Button>
              </div>
            </form>
            <PlanEditor
              key={`${date}-${days}-${plan?.updatedAt.getTime() ?? 0}`}
              date={date}
              canWrite={canWrite}
              capacityKg={capacityKg}
              minBatchKg={minBatchKg}
              demands={suggested.demands}
              suggestion={suggested.suggestion}
              plan={plan ? { status: plan.status, items: plan.items } : null}
            />
            {suggested.pendingOrders.length > 0 ? (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Pedidos considerados ({suggested.pendingOrders.length})
                </summary>
                <Table className="mt-2">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pedido</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Entrega</TableHead>
                      <TableHead className="hidden sm:table-cell">Estado</TableHead>
                      <TableHead className="text-right">Kg</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suggested.pendingOrders.map((o, i) => (
                      <TableRow key={`${o.orderId}-${i}`}>
                        <TableCell>#{o.number}</TableCell>
                        <TableCell>
                          {o.customer}
                          <div className="text-muted-foreground text-xs">
                            {o.units} × {o.productName}
                          </div>
                        </TableCell>
                        <TableCell>
                          <DateText value={o.promisedDate} />
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {ORDER_STATUS[o.status]?.label ?? o.status}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtQty(o.kg, 1)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </details>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Semana</CardTitle>
            <CardDescription>Kg planificados por día contra la capacidad del abatidor.</CardDescription>
          </CardHeader>
          <CardContent>
            <WeekPlan days={week} capacityKg={capacityKg} today={today} selected={date} />
          </CardContent>
        </Card>

        <section aria-labelledby="lotes">
          <h2 id="lotes" className="mb-2 text-lg font-semibold">
            Lotes terminados recientes
          </h2>
          {lots.length === 0 ? (
            <EmptyState title="Todavía no hay lotes" description="Se crean al envasar una producción." />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lote</TableHead>
                    <TableHead>Elaboración</TableHead>
                    <TableHead>Vence</TableHead>
                    <TableHead className="text-right">Stock (u.)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lots.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <Link href={`/produccion/lotes/${l.code}`} className="font-medium hover:underline">
                          {l.code}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <DateText value={l.productionDate} />
                      </TableCell>
                      <TableCell>
                        <DateText value={l.expiryDate} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(l.stockUnits)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
