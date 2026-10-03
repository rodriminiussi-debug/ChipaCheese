"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CloudOff, SprayCan, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { OFFLINE_ACTION } from "@/components/pwa/offline-actions";
import { useOfflineAction } from "@/hooks/use-offline-action";
import { cn } from "@/lib/utils";
import { recordCleaningAction } from "../actions";
import { CLEANING_FREQUENCY, CLEANING_RESULT } from "../labels";

export interface ChecklistItemView {
  pointId: string;
  sector: string;
  element: string;
  frequency: "daily" | "weekly" | "monthly";
  status: "pending" | "done" | "done_period";
  result: "ok" | "deepen" | null;
  notes: string | null;
  /** Hora de la carga de hoy (HH:MM) o fecha ya cubierta (dd/mm). */
  doneLabel: string | null;
  userInitials: string | null;
}

/**
 * Checklist de limpieza del día para la tablet (RF-34). Botones grandes (h-16), un toque por punto;
 * "A profundizar" pide una nota opcional. Cada toque se guarda solo (con cola offline).
 */
export function CleaningChecklist({ items }: { items: ChecklistItemView[] }) {
  const bySector = new Map<string, ChecklistItemView[]>();
  for (const i of items) bySector.set(i.sector, [...(bySector.get(i.sector) ?? []), i]);
  const total = items.length;
  const [doneNow, setDoneNow] = useState<Set<string>>(new Set());
  const done = items.filter((i) => i.status !== "pending" || doneNow.has(i.pointId)).length;

  return (
    <div className="space-y-6">
      <p className="text-xl font-semibold" data-testid="cleaning-progress">
        {done} de {total} puntos al día
      </p>
      {[...bySector.entries()].map(([sector, rows]) => (
        <section key={sector} className="space-y-3">
          <h2 className="text-2xl font-bold">{sector}</h2>
          <ul className="space-y-3">
            {rows.map((r) => (
              <PointRow
                key={r.pointId}
                item={r}
                onDone={() => setDoneNow((s) => new Set(s).add(r.pointId))}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PointRow({ item, onDone }: { item: ChecklistItemView; onDone: () => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<{ result: "ok" | "deepen"; queued: boolean } | null>(null);
  const lastResult = useRef<"ok" | "deepen">("ok");

  const { run, pending } = useOfflineAction(OFFLINE_ACTION.cleaning, recordCleaningAction, {
    success: "Limpieza registrada",
    onSuccess: (_data, queued) => {
      setSaved({ result: lastResult.current, queued });
      setEditing(false);
      onDone();
      if (!queued) router.refresh();
    },
  });

  function save(result: "ok" | "deepen", notes: string | null) {
    lastResult.current = result;
    run({
      clientId: crypto.randomUUID(),
      recordedAt: new Date().toISOString(),
      pointId: item.pointId,
      result,
      notes,
    });
  }

  const shownResult = saved?.result ?? item.result;
  const isDone = !!saved || item.status === "done";
  const coveredEarlier = !saved && item.status === "done_period";

  return (
    <li
      role="group"
      aria-label={item.element}
      className={cn(
        "bg-card rounded-xl border p-4 shadow-sm",
        isDone && shownResult === "ok" && "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30",
        isDone && shownResult === "deepen" && "border-amber-300 bg-amber-50 dark:bg-amber-950/30",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xl font-semibold">{item.element}</p>
          <p className="text-muted-foreground text-base">{CLEANING_FREQUENCY[item.frequency]}</p>
        </div>
        {isDone && shownResult ? (
          <p className="flex items-center gap-2 text-xl font-semibold" data-testid="point-status">
            {saved?.queued ? <CloudOff className="size-6" /> : <CheckCircle2 className="size-6" />}
            {CLEANING_RESULT[shownResult]!.label}
            {saved?.queued
              ? " (en cola)"
              : item.doneLabel
                ? ` · ${item.userInitials ?? ""} ${item.doneLabel}`
                : ""}
          </p>
        ) : coveredEarlier ? (
          <p className="text-muted-foreground text-lg" data-testid="point-status">
            Al día · {item.doneLabel}
          </p>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-3 space-y-3">
          <Textarea
            aria-label="Nota"
            placeholder="¿Qué hay que profundizar? (opcional)"
            className="min-h-24 text-xl"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-16 text-xl"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              Volver
            </Button>
            <Button
              type="button"
              className="h-16 bg-amber-500 text-xl text-white hover:bg-amber-600"
              onClick={() => save("deepen", note.trim() || null)}
              disabled={pending}
            >
              <TriangleAlert className="size-6" /> Guardar
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Button
            type="button"
            className="h-16 bg-emerald-600 text-xl text-white hover:bg-emerald-700"
            onClick={() => save("ok", null)}
            disabled={pending}
          >
            <SprayCan className="size-6" /> Correcto
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-16 border-amber-400 text-xl text-amber-900 dark:text-amber-200"
            onClick={() => setEditing(true)}
            disabled={pending}
          >
            A profundizar
          </Button>
        </div>
      )}
    </li>
  );
}
