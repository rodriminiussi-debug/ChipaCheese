import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { DateText } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { todayAR } from "@/lib/dates";
import { CONSUMPTION_STATUSES, WEIGHING_STATUSES } from "@/features/production/calc";
import { ConsumptionForm } from "@/features/production/components/consumption-form";
import { PlantRunPicker } from "@/features/production/components/plant-run-picker";
import { RunStatusControls } from "@/features/production/components/run-status-controls";
import { LateBadge } from "@/features/production/components/runs-table";
import { WeighingForm, WeighingsList } from "@/features/production/components/weighing-form";
import { fmtQty } from "@/features/production/format";
import { RUN_STATUS } from "@/features/production/labels";
import { consumptionSuggestions, getRun, listActiveRuns, runSummary } from "@/features/production/service";

export const metadata = { title: "Producción y pesadas" };

/** Modo planta: producción de hoy. Consumo real, pesadas y estado con botones grandes. */
export default async function PlantProductionPage(props: PageProps<"/planta/produccion">) {
  await requirePermission("production:record");
  const sp = await props.searchParams;
  const runs = await listActiveRuns(db, todayAR());
  const chosenId = typeof sp.id === "string" ? sp.id : runs.length === 1 ? runs[0]!.id : undefined;
  const run = chosenId ? await getRun(db, chosenId) : undefined;

  const back = (
    <Link href="/planta" className="flex h-14 items-center gap-2 rounded-lg border px-4 text-lg font-medium">
      <ArrowLeft /> Inicio
    </Link>
  );

  if (!run) {
    return (
      <div className="grid gap-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">Producción y pesadas</h1>
          {back}
        </div>
        {runs.length === 0 ? (
          <p className="bg-card rounded-xl border p-6 text-xl">
            No hay producciones abiertas. La jefa de producción tiene que crear la de hoy.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground text-lg">Elegí la producción:</p>
            <PlantRunPicker runs={runs} basePath="/planta/produccion" />
          </>
        )}
      </div>
    );
  }

  const status = RUN_STATUS[run.status]!;
  const canConsume = CONSUMPTION_STATUSES.includes(run.status) && run.consumptions.length === 0;
  const canWeigh = WEIGHING_STATUSES.includes(run.status);
  const summary = runSummary(run);
  const suggestions = canConsume ? await consumptionSuggestions(db, run) : [];
  const outOfRange = run.consumptions.filter((c) => c.outOfRange).length;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Producción N° {run.runNumber}</h1>
          <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-lg">
            <DateText value={run.date} />
            <StatusBadge tone={status.tone} className="px-3 py-1 text-base">
              {status.label}
            </StatusBadge>
            {run.lateEntry ? <LateBadge /> : null}
          </p>
        </div>
        {back}
      </div>

      <section className="grid gap-3" aria-label="Estado">
        <RunStatusControls runId={run.id} status={run.status} canManage={false} variant="plant" />
      </section>

      <section className="grid gap-3" aria-labelledby="consumos">
        <h2 id="consumos" className="text-2xl font-semibold">
          Consumo real
        </h2>
        {canConsume ? (
          <ConsumptionForm
            runId={run.id}
            suggestions={suggestions}
            thresholdPct={run.recipe.deviationThresholdPct}
            variant="plant"
          />
        ) : run.consumptions.length ? (
          <p className="bg-card rounded-xl border p-4 text-lg">
            Consumos cargados ({run.consumptions.length} líneas).
            {outOfRange ? (
              <span className="ml-1 font-semibold text-amber-700 dark:text-amber-400">
                {outOfRange} fuera de rango.
              </span>
            ) : null}
          </p>
        ) : (
          <p className="text-muted-foreground text-lg">Ya no se pueden cargar consumos en esta producción.</p>
        )}
      </section>

      <section className="grid gap-3" aria-labelledby="pesadas">
        <h2 id="pesadas" className="text-2xl font-semibold">
          Pesadas
        </h2>
        <p className="text-lg">
          Pesado: <strong>{fmtQty(summary.weighedKg, 1)} kg</strong>
          {summary.weighedKg > 0 ? (
            <>
              {" "}
              · Rendimiento <strong>{fmtQty(summary.yieldRatio * 100, 1)} %</strong> · Merma{" "}
              <strong>{fmtQty(summary.lossKg, 1)} kg</strong>
            </>
          ) : null}
        </p>
        <WeighingsList weighings={run.weighings} editable={canWeigh} />
        {canWeigh ? (
          <WeighingForm runId={run.id} variant="plant" />
        ) : (
          <p className="text-muted-foreground text-lg">
            Las pesadas se cargan cuando la producción está en elaboración.
          </p>
        )}
      </section>

      <Link
        href="/planta/envasado"
        className="bg-primary text-primary-foreground flex h-16 items-center justify-center rounded-xl text-xl font-semibold"
      >
        Ir a envasado
      </Link>
    </div>
  );
}
