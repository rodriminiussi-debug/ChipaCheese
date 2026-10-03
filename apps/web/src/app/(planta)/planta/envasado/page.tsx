import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { finishedLotCode } from "@chipa/domain";
import { DateText } from "@/components/app/format";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { todayAR } from "@/lib/dates";
import { SHAPE } from "@/lib/labels";
import { PACKING_STATUSES } from "@/features/production/calc";
import { PlantPackingForm } from "@/features/production/components/plant-packing-form";
import { PlantRunPicker } from "@/features/production/components/plant-run-picker";
import { RunStatusControls } from "@/features/production/components/run-status-controls";
import { getRun, listActiveRuns, packingOptions } from "@/features/production/service";

export const metadata = { title: "Envasado y etiquetas" };

/** Modo planta: envasado. Producto, bolsas con +/−, ubicación y confirmar. Crea el lote si no existe. */
export default async function PlantPackingPage(props: PageProps<"/planta/envasado">) {
  await requirePermission("production:record");
  const sp = await props.searchParams;
  // Se envasa lo elaborado ayer (congelado de noche): no solo las producciones de hoy.
  const runs = (await listActiveRuns(db, todayAR())).filter((r) => PACKING_STATUSES.includes(r.status));
  const chosenId = typeof sp.id === "string" ? sp.id : runs.length === 1 ? runs[0]!.id : undefined;
  const run = chosenId ? await getRun(db, chosenId) : undefined;

  const back = (
    <Link href="/planta" className="flex h-14 items-center gap-2 rounded-lg border px-4 text-lg font-medium">
      <ArrowLeft /> Inicio
    </Link>
  );

  if (!run || !PACKING_STATUSES.includes(run.status)) {
    return (
      <div className="grid gap-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">Envasado y etiquetas</h1>
          {back}
        </div>
        {runs.length === 0 ? (
          <p className="bg-card rounded-xl border p-6 text-xl">
            No hay producciones para envasar. Primero tiene que estar en elaboración o en congelado.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground text-lg">Elegí la producción a envasar:</p>
            <PlantRunPicker runs={runs} basePath="/planta/envasado" />
          </>
        )}
      </div>
    );
  }

  const options = await packingOptions(db);
  const lotCode = run.lots[0]?.code ?? finishedLotCode(run.date, run.runNumber);
  const packed = run.lots.flatMap((l) => l.packings);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Envasado · Producción N° {run.runNumber}</h1>
          <p className="text-muted-foreground text-lg">
            <DateText value={run.date} /> · lote {lotCode}
          </p>
        </div>
        {back}
      </div>

      <PlantPackingForm runId={run.id} options={options} lotCode={lotCode} />

      <section className="grid gap-2" aria-labelledby="envasado-hecho">
        <h2 id="envasado-hecho" className="text-2xl font-semibold">
          Envasado de este lote
        </h2>
        {packed.length === 0 ? (
          <p className="text-muted-foreground text-lg">Todavía no se envasó nada.</p>
        ) : (
          <ul className="divide-y rounded-xl border text-lg">
            {packed.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-3">
                <span>
                  {p.product.name}
                  <span className="text-muted-foreground block text-base">
                    {SHAPE[p.product.shape]} · {p.location.code}
                  </span>
                </span>
                <span className="text-xl font-semibold tabular-nums">{p.units} u.</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RunStatusControls runId={run.id} status={run.status} canManage={false} variant="plant" />
    </div>
  );
}
