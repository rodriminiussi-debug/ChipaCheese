"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateAR, isoWeekday } from "@chipa/domain";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { recordBackdatedCleaningAction } from "../actions";
import { CLEANING_RESULT } from "../labels";

export interface GridCellView {
  result: "ok" | "deepen";
  lateEntry: boolean;
  title: string;
}
export interface GridRowView {
  pointId: string;
  sector: string;
  element: string;
  cells: Record<string, GridCellView>;
  gaps: string[];
}

const WEEKDAY_INITIAL = ["", "L", "M", "X", "J", "V", "S", "D"];

/**
 * Planilla mensual de limpieza (sector/elemento × día). Los huecos (días esperados sin registro) se ven
 * en rojo. Con permiso de escritura, tocar una celda vacía carga ese día (queda como carga tardía).
 */
export function CleaningGrid({
  days,
  rows,
  today,
  canWrite,
}: {
  days: string[];
  rows: GridRowView[];
  today: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<{ pointId: string; element: string; date: string } | null>(null);
  const [notes, setNotes] = useState("");
  const save = useAction(recordBackdatedCleaningAction, {
    success: "Limpieza cargada (carga tardía)",
    onSuccess: () => {
      setTarget(null);
      setNotes("");
      router.refresh();
    },
  });

  function submit(result: "ok" | "deepen") {
    if (!target) return;
    void save.run({
      clientId: crypto.randomUUID(),
      date: target.date,
      pointId: target.pointId,
      result,
      notes: notes.trim() || null,
    });
  }

  const isLate = target ? target.date < today : false;

  return (
    <>
      <div className="overflow-x-auto rounded-lg border" data-testid="cleaning-grid">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-muted/50">
              <th className="bg-muted sticky left-0 z-10 min-w-40 border-r px-2 py-1 text-left">
                Sector / elemento
              </th>
              {days.map((d) => {
                const wd = isoWeekday(d);
                return (
                  <th
                    key={d}
                    className={cn(
                      "min-w-7 border-r px-0.5 py-1 text-center font-medium",
                      wd >= 6 && "bg-muted text-muted-foreground",
                      d === today && "bg-primary/10",
                    )}
                  >
                    <div>{Number(d.slice(8))}</div>
                    <div className="text-muted-foreground font-normal">{WEEKDAY_INITIAL[wd]}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pointId} className="border-t">
                <th scope="row" className="bg-background sticky left-0 z-10 border-r px-2 py-1 text-left">
                  <div className="text-muted-foreground text-[10px] leading-none">{r.sector}</div>
                  <div className="font-medium">{r.element}</div>
                </th>
                {days.map((d) => {
                  const cell = r.cells[d];
                  const gap = r.gaps.includes(d);
                  const wd = isoWeekday(d);
                  const label = `${r.element} ${formatDateAR(d)}`;
                  if (cell) {
                    const meta = CLEANING_RESULT[cell.result]!;
                    return (
                      <td
                        key={d}
                        title={cell.title}
                        aria-label={`${label}: ${meta.label}${cell.lateEntry ? " (carga tardía)" : ""}`}
                        data-late={cell.lateEntry || undefined}
                        className={cn(
                          "border-r text-center font-semibold",
                          cell.result === "ok"
                            ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                            : "bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
                          cell.lateEntry && "italic underline decoration-dotted",
                        )}
                      >
                        {meta.short}
                        {cell.lateEntry ? "*" : ""}
                      </td>
                    );
                  }
                  const loadable = canWrite && d <= today;
                  return (
                    <td
                      key={d}
                      data-gap={gap || undefined}
                      className={cn(
                        "border-r p-0 text-center",
                        wd >= 6 && "bg-muted/60",
                        gap && "bg-red-100 dark:bg-red-950/60",
                      )}
                    >
                      {loadable ? (
                        <button
                          type="button"
                          aria-label={`${label}: ${gap ? "sin registro" : "cargar"}`}
                          onClick={() => setTarget({ pointId: r.pointId, element: r.element, date: d })}
                          className="hover:bg-primary/10 h-7 w-full cursor-pointer text-red-700"
                        >
                          {gap ? "·" : ""}
                        </button>
                      ) : gap ? (
                        <span aria-label={`${label}: sin registro`} className="block h-7 text-red-700">
                          ·
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        x = correcto · P = a profundizar · * = carga tardía ·{" "}
        <span className="rounded bg-red-100 px-1 dark:bg-red-950">·</span> = día hábil sin registro (hueco)
        {canWrite ? " · tocá una celda vacía para cargar ese día." : ""}
      </p>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Cargar limpieza: {target?.element} — {target ? formatDateAR(target.date) : ""}
            </DialogTitle>
            <DialogDescription>
              {isLate
                ? "Es un día pasado: el registro queda marcado como carga tardía, con tu usuario y la hora de hoy."
                : "Se registra con tu usuario y la hora actual."}
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Nota"
            placeholder="Nota (opcional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => submit("deepen")} disabled={save.pending}>
              A profundizar
            </Button>
            <Button onClick={() => submit("ok")} disabled={save.pending}>
              Correcto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
