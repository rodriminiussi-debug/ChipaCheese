"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Save, Wand2 } from "lucide-react";
import { parseDecimalAR, roundQty, validateDailyLoad } from "@chipa/domain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { SHAPE } from "@/lib/labels";
import { confirmPlanAction, savePlanAction } from "../actions";
import { capacityUsage, PLAN_SHAPES, type PlanShape } from "../calc";
import { fmtQty } from "../format";
import { PLAN_STATUS } from "../labels";

export interface PlanEditorProps {
  date: string;
  canWrite: boolean;
  capacityKg: number;
  minBatchKg: number;
  demands: { shape: string; pendingKg: number; stockKg: number; minStockKg: number }[];
  suggestion: { totalKg: number; byShape: { shape: string; kg: number }[]; unmetKg: number };
  plan: { status: string; items: { shape: string; kg: number }[] } | null;
}

/**
 * Plan diario (RF-19): muestra pendiente, stock y mínimo por forma, la sugerencia del dominio y deja
 * ajustar los kg a producir. Guardar deja el plan en borrador; confirmar valida mínimo y capacidad.
 */
export function PlanEditor({
  date,
  canWrite,
  capacityKg,
  minBatchKg,
  demands,
  suggestion,
  plan,
}: PlanEditorProps) {
  const router = useRouter();
  const initial = (shape: PlanShape) => {
    const saved = plan?.items.find((i) => i.shape === shape)?.kg;
    return String(saved ?? suggestion.byShape.find((s) => s.shape === shape)?.kg ?? 0).replace(".", ",");
  };
  const [kg, setKg] = useState<Record<PlanShape, string>>({
    tapita: initial("tapita"),
    arito: initial("arito"),
    lenguita: initial("lenguita"),
  });
  const save = useAction(savePlanAction, { success: "Plan guardado", onSuccess: () => router.refresh() });
  const confirm = useAction(confirmPlanAction, {
    success: "Plan confirmado",
    onSuccess: () => router.refresh(),
  });

  const parsed = PLAN_SHAPES.map((shape) => ({ shape, kg: parseDecimalAR(kg[shape]) ?? 0 }));
  const total = roundQty(parsed.reduce((a, p) => a + Math.max(0, p.kg), 0));
  const check = validateDailyLoad(total, capacityKg, minBatchKg);
  const usage = capacityUsage(total, capacityKg);
  const status = plan ? PLAN_STATUS[plan.status] : null;
  const pending = save.pending || confirm.pending;
  const payload = { date, items: parsed.map((p) => ({ shape: p.shape, kg: Math.max(0, p.kg) })) };

  async function saveAndConfirm() {
    const saved = await save.run(payload);
    if (saved.ok) await confirm.run({ date });
  }

  const tdNum = "text-right tabular-nums";
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {status ? <StatusBadge tone={status.tone}>Plan {status.label.toLowerCase()}</StatusBadge> : null}
        {!plan ? <StatusBadge tone="neutral">Sin plan guardado</StatusBadge> : null}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Forma</TableHead>
              <TableHead className="text-right">Pendiente (kg)</TableHead>
              <TableHead className="text-right">Stock (kg)</TableHead>
              <TableHead className="text-right">Mínimo (kg)</TableHead>
              <TableHead className="text-right">Sugerido (kg)</TableHead>
              <TableHead className="w-36 text-right">Plan (kg)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PLAN_SHAPES.map((shape) => {
              const d = demands.find((x) => x.shape === shape)!;
              const sug = suggestion.byShape.find((s) => s.shape === shape)?.kg ?? 0;
              return (
                <TableRow key={shape}>
                  <TableCell className="font-medium">{SHAPE[shape]}</TableCell>
                  <TableCell className={tdNum}>{fmtQty(d.pendingKg, 1)}</TableCell>
                  <TableCell className={tdNum}>{fmtQty(d.stockKg, 1)}</TableCell>
                  <TableCell className={tdNum}>{fmtQty(d.minStockKg, 1)}</TableCell>
                  <TableCell className={`${tdNum} font-medium`}>{fmtQty(sug, 1)}</TableCell>
                  <TableCell>
                    <Input
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      aria-label={`Kg planificados de ${SHAPE[shape].toLowerCase()}`}
                      value={kg[shape]}
                      disabled={!canWrite}
                      onChange={(e) => setKg((k) => ({ ...k, [shape]: e.target.value }))}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="font-medium">
                Total
              </TableCell>
              <TableCell className={`${tdNum} font-medium`}>{fmtQty(suggestion.totalKg, 1)}</TableCell>
              <TableCell className={`${tdNum} text-base font-semibold`} data-testid="plan-total">
                {fmtQty(total, 1)} kg
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      <div className="grid gap-1" aria-label="Uso de la capacidad diaria">
        <div className="flex justify-between text-sm">
          <span>Capacidad diaria del abatidor</span>
          <span className="tabular-nums">
            {fmtQty(total, 1)} de {fmtQty(capacityKg)} kg ({usage.pct} %)
          </span>
        </div>
        <Progress
          value={Math.min(100, usage.pct)}
          className={
            usage.tone === "bad"
              ? "h-2 [&_[data-slot=progress-indicator]]:bg-destructive"
              : usage.tone === "warn"
                ? "h-2 [&_[data-slot=progress-indicator]]:bg-amber-500"
                : "h-2"
          }
        />
      </div>

      {!check.ok ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>
            {check.reason === "over_capacity"
              ? "El plan supera la capacidad del abatidor"
              : "El plan no llega al mínimo por tanda"}
          </AlertTitle>
          <AlertDescription>
            {check.reason === "over_capacity"
              ? `Máximo ${fmtQty(capacityKg)} kg por día (Regla 1).`
              : `El mínimo es ${fmtQty(minBatchKg)} kg por tanda: producí ${fmtQty(minBatchKg)} kg o nada.`}
          </AlertDescription>
        </Alert>
      ) : null}
      {suggestion.unmetKg > 0 ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Hay demanda que no entra en el día</AlertTitle>
          <AlertDescription>
            Faltan {fmtQty(suggestion.unmetKg, 1)} kg por la capacidad de {fmtQty(capacityKg)} kg: pasan al
            próximo día.
          </AlertDescription>
        </Alert>
      ) : null}

      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              setKg({
                tapita: String(suggestion.byShape.find((s) => s.shape === "tapita")?.kg ?? 0).replace(".", ","),
                arito: String(suggestion.byShape.find((s) => s.shape === "arito")?.kg ?? 0).replace(".", ","),
                lenguita: String(suggestion.byShape.find((s) => s.shape === "lenguita")?.kg ?? 0).replace(".", ","),
              })
            }
          >
            <Wand2 /> Usar sugerido
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => save.run(payload)}>
            <Save /> Guardar plan
          </Button>
          <Button type="button" disabled={pending || !check.ok} onClick={saveAndConfirm}>
            <CheckCircle2 /> Confirmar plan
          </Button>
        </div>
      ) : null}
    </div>
  );
}
