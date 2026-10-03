import { SHAPE } from "@/lib/labels";
import { StatCard } from "@/components/app/stat-card";
import { fmtQty } from "../format";
import type { RunSummary } from "@chipa/domain";

/** Rendimiento y merma de la producción (RF-21 / Regla 3) contra lo esperado de la receta. */
export function RunSummaryCards({ summary }: { summary: RunSummary }) {
  const s = summary;
  const hasWeighings = s.weighedKg > 0;
  const deltaTone = !hasWeighings
    ? "default"
    : Math.abs(s.deltaKg) <= s.expectedWeighedKg * 0.03
      ? "good"
      : "warn";
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Rendimiento">
      <StatCard
        title="Kg pesados"
        testId="stat-weighed"
        value={`${fmtQty(s.weighedKg, 1)} kg`}
        hint={
          hasWeighings
            ? (Object.keys(s.byShape) as (keyof typeof s.byShape)[])
                .map((k) => `${SHAPE[k]} ${fmtQty(s.byShape[k], 1)}`)
                .join(" · ")
            : "Sin pesadas todavía"
        }
      />
      <StatCard
        title={
          s.ingredientsSource === "actual" ? "Kg de ingredientes reales" : "Kg de ingredientes (teóricos)"
        }
        testId="stat-ingredients"
        value={`${fmtQty(s.ingredientsKg, 1)} kg`}
        hint={
          s.ingredientsSource === "actual"
            ? "Suma de los consumos cargados"
            : "Todavía no se cargaron consumos"
        }
      />
      <StatCard
        title="Rendimiento"
        testId="stat-yield"
        value={hasWeighings ? `${fmtQty(s.yieldRatio * 100, 1)} %` : "—"}
        hint="Kg pesados ÷ kg de ingredientes"
        tone={hasWeighings ? "default" : "default"}
      />
      <StatCard
        title="Merma"
        testId="stat-loss"
        value={hasWeighings ? `${fmtQty(s.lossKg, 1)} kg` : "—"}
        hint="Ingredientes − pesado"
      />
      <StatCard
        title="Bolsas equivalentes"
        testId="stat-bags"
        value={hasWeighings ? fmtQty(s.bags, 0) : "—"}
        hint="Kg pesados ÷ 0,5 kg"
      />
      <StatCard
        title="Kg por kg de fécula"
        testId="stat-per-starch"
        value={s.kgPerKgStarch != null ? fmtQty(s.kgPerKgStarch) : "—"}
        hint={`Esperado de la receta: ${fmtQty(s.expectedKgPerKgStarch)}`}
        tone={deltaTone}
      />
      <StatCard
        title="Contra lo esperado"
        testId="stat-delta"
        value={hasWeighings ? `${s.deltaKg > 0 ? "+" : ""}${fmtQty(s.deltaKg, 1)} kg` : "—"}
        hint={`Esperado: ${fmtQty(s.expectedWeighedKg, 1)} kg pesados`}
        tone={deltaTone}
      />
    </div>
  );
}
