import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DateText, Kg } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { can } from "@/lib/rbac";
import { formatTimeAR } from "@/lib/dates";
import { SHAPE } from "@/lib/labels";
import { ConsumptionForm } from "@/features/production/components/consumption-form";
import { ConsumptionTable } from "@/features/production/components/consumption-table";
import { PackingForm } from "@/features/production/components/packing-form";
import { RunStatusControls } from "@/features/production/components/run-status-controls";
import { RunSummaryCards } from "@/features/production/components/run-summary";
import { LateBadge } from "@/features/production/components/runs-table";
import { WeighingForm, WeighingsList } from "@/features/production/components/weighing-form";
import { CONSUMPTION_STATUSES, PACKING_STATUSES, WEIGHING_STATUSES } from "@/features/production/calc";
import { fmtQty } from "@/features/production/format";
import { RUN_STATUS, SHIFT } from "@/features/production/labels";
import { consumptionSuggestions, getRun, packingOptions, runSummary } from "@/features/production/service";

export const metadata = { title: "Producción" };

export default async function RunPage(props: PageProps<"/produccion/[id]">) {
  const user = await requirePermission("production:read");
  const { id } = await props.params;
  const run = await getRun(db, id);
  if (!run) notFound();

  const canRecord = can(user.role, ["production:write", "production:record"]);
  const canManage = can(user.role, "production:write");
  const status = RUN_STATUS[run.status]!;
  const summary = runSummary(run);
  const canConsume = canRecord && CONSUMPTION_STATUSES.includes(run.status);
  const canWeigh = canRecord && WEIGHING_STATUSES.includes(run.status);
  const canPack = canRecord && PACKING_STATUSES.includes(run.status);

  const [suggestions, packOptions] = await Promise.all([
    canConsume ? consumptionSuggestions(db, run) : Promise.resolve([]),
    canPack ? packingOptions(db) : Promise.resolve(null),
  ]);
  // Al corregir, el formulario arranca con lo ya cargado (no con el teórico).
  const formSuggestions = suggestions.map((s) => {
    const prior = run.consumptions.filter((c) => c.ingredientId === s.ingredientId);
    return prior.length ? { ...s, lines: prior.map((c) => ({ rawLotId: c.rawLotId, qty: c.qtyActual })) } : s;
  });
  const lot = run.lots[0];
  const packings = run.lots.flatMap((l) => l.packings.map((p) => ({ ...p, lotCode: l.code })));

  return (
    <>
      <PageHeader
        title={`Producción N° ${run.runNumber}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <DateText value={run.date} /> · {SHIFT[run.shift]}
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            {run.lateEntry ? <LateBadge /> : null}
            {lot ? (
              <Link href={`/produccion/lotes/${lot.code}`} className="font-medium hover:underline">
                Lote {lot.code}
              </Link>
            ) : null}
          </span>
        }
        actions={
          <Button variant="outline" asChild>
            <Link href="/produccion">Volver a producción</Link>
          </Button>
        }
      />

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Datos y estado</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Receta</dt>
                <dd className="font-medium">
                  {run.recipe.name} v{run.recipe.version}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Fécula</dt>
                <dd className="font-medium">
                  <Kg value={run.starchKg} /> · {run.batches} tandas
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Responsable</dt>
                <dd className="font-medium">{run.responsible?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Supervisor</dt>
                <dd className="font-medium">{run.supervisor?.name ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Operarios</dt>
                <dd className="font-medium">{run.workers.map((w) => w.user.initials).join(", ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Congelado</dt>
                <dd className="font-medium">
                  {run.freezerCodes.length
                    ? `${run.freezerCodes.join(" + ")}${run.frozenAt ? ` · ${formatTimeAR(run.frozenAt)}` : ""}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Plan del día</dt>
                <dd className="font-medium">{run.plan ? `${fmtQty(run.plan.totalKg, 1)} kg` : "Sin plan"}</dd>
              </div>
            </dl>
            {run.notes ? <p className="text-muted-foreground text-sm">{run.notes}</p> : null}
            {canRecord ? (
              <RunStatusControls runId={run.id} status={run.status} canManage={canManage} />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Consumos de materia prima</CardTitle>
            <CardDescription>
              Teórico de la receta para {fmtQty(run.starchKg)} kg de fécula contra lo realmente usado, con el
              lote de cada insumo (vence primero, sale primero). El umbral de desvío es{" "}
              {fmtQty(run.recipe.deviationThresholdPct)} %.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {run.consumptions.length ? <ConsumptionTable consumptions={run.consumptions} /> : null}
            {canConsume ? (
              run.consumptions.length ? (
                <details className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Corregir consumos</summary>
                  <div className="mt-3">
                    <ConsumptionForm
                      runId={run.id}
                      suggestions={formSuggestions}
                      thresholdPct={run.recipe.deviationThresholdPct}
                      replacing
                    />
                  </div>
                </details>
              ) : (
                <ConsumptionForm
                  runId={run.id}
                  suggestions={formSuggestions}
                  thresholdPct={run.recipe.deviationThresholdPct}
                />
              )
            ) : !run.consumptions.length ? (
              <p className="text-muted-foreground text-sm">No se cargaron consumos.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pesadas y rendimiento</CardTitle>
            <CardDescription>
              Kg pesados por forma, rendimiento, merma y bolsas equivalentes (Regla 3).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <RunSummaryCards summary={summary} />
            <WeighingsList weighings={run.weighings} editable={canWeigh} />
            {canWeigh ? <WeighingForm runId={run.id} /> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Envasado y lote</CardTitle>
            <CardDescription>
              Bolsas por producto y ubicación. El lote ({lot?.code ?? "AAMMDD-N"}) se crea al primer envasado
              y vence a los 6 meses; los envases se descuentan del depósito seco.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {packings.length ? (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead className="text-right">Bolsas</TableHead>
                      <TableHead className="text-right">Kg</TableHead>
                      <TableHead>Ubicación</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {packings.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">
                          {p.product.name}
                          <div className="text-muted-foreground text-xs">
                            {SHAPE[p.product.shape]} · lote {p.lotCode}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{p.units}</TableCell>
                        <TableCell className="text-right">
                          <Kg value={p.kg} />
                        </TableCell>
                        <TableCell>{p.location.code}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" asChild>
                            <Link
                              href={`/produccion/lotes/${p.lotCode}/etiqueta?producto=${p.productId}&copias=1`}
                            >
                              <Printer /> Etiqueta
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">Todavía no se envasó nada.</p>
            )}
            {packOptions ? <PackingForm runId={run.id} options={packOptions} /> : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
