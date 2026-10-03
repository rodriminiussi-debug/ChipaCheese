"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { parseDecimalAR, PLAN_SHAPES, type PlanShape } from "@chipa/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { SHAPE } from "@/lib/labels";
import { deleteWeighingAction, recordWeighingsAction } from "../actions";
import { fmtQty } from "../format";

/** Pesadas por forma (RF-21): un kg por forma; se pueden cargar varias veces (bandejas) y se suman. */
export function WeighingForm({ runId, variant = "desk" }: { runId: string; variant?: "desk" | "plant" }) {
  const router = useRouter();
  const plant = variant === "plant";
  const empty = { tapita: "", arito: "", lenguita: "" } satisfies Record<PlanShape, string>;
  const [kg, setKg] = useState<Record<PlanShape, string>>(empty);
  const save = useAction(recordWeighingsAction, {
    success: "Pesadas registradas",
    onSuccess: () => {
      setKg(empty);
      router.refresh();
    },
  });
  const items = PLAN_SHAPES.map((shape) => ({ shape, kg: parseDecimalAR(kg[shape]) ?? 0 })).filter(
    (i) => i.kg > 0,
  );

  return (
    <div className="grid gap-3">
      <div className={cn("grid gap-3", plant ? "sm:grid-cols-3" : "sm:max-w-2xl sm:grid-cols-3")}>
        {PLAN_SHAPES.map((shape) => (
          <label key={shape} className={cn("grid gap-1 text-sm font-medium", plant && "text-lg")}>
            {SHAPE[shape]} (kg)
            <Input
              inputMode="decimal"
              placeholder="0"
              aria-label={`Pesada de ${SHAPE[shape].toLowerCase()} en kg`}
              className={cn("text-right tabular-nums", plant && "h-16 text-2xl")}
              value={kg[shape]}
              onChange={(e) => setKg((k) => ({ ...k, [shape]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <Button
        type="button"
        size={plant ? "lg" : "default"}
        className={cn("w-full sm:w-fit", plant && "h-16 text-xl sm:w-full")}
        disabled={save.pending || items.length === 0}
        onClick={() => save.run({ runId, items })}
      >
        Guardar pesadas
      </Button>
    </div>
  );
}

export function WeighingsList({
  weighings,
  editable,
}: {
  weighings: { id: string; shape: string; kg: number; weighedAt: Date }[];
  editable: boolean;
}) {
  const router = useRouter();
  const del = useAction(deleteWeighingAction, {
    success: "Pesada eliminada",
    onSuccess: () => router.refresh(),
  });
  if (!weighings.length) return <p className="text-muted-foreground text-sm">Todavía no hay pesadas.</p>;
  return (
    <ul className="divide-y rounded-lg border text-sm" aria-label="Pesadas cargadas">
      {weighings.map((w) => (
        <li key={w.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
          <span>
            {SHAPE[w.shape]} · <span className="font-medium tabular-nums">{fmtQty(w.kg)} kg</span>
          </span>
          {editable ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Eliminar pesada de ${SHAPE[w.shape].toLowerCase()} ${fmtQty(w.kg)} kg`}
              disabled={del.pending}
              onClick={() => del.run({ id: w.id })}
            >
              <Trash2 />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
