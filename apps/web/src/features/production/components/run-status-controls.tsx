"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CloudOff } from "lucide-react";
import { OFFLINE_ACTION } from "@/components/pwa/offline-actions";
import { useOfflineAction, useQueuedItems } from "@/hooks/use-offline-action";
import { cn } from "@/lib/utils";
import { setRunStatusAction } from "../actions";
import { nextRunStatuses, type RunStatus } from "@chipa/domain";
import { FREEZER_CODES, RUN_STATUS_ACTION } from "../labels";
import type { SetRunStatusPayload } from "../schemas";

/**
 * Botones de transición de estado (planned → in_progress → freezing → packed → closed). Pasar a congelado
 * pide el abatidor (F1/F2) y la hora. Cerrar y cancelar solo para quien puede (`canManage`).
 */
export function RunStatusControls({
  runId,
  status,
  canManage,
  variant = "desk",
}: {
  runId: string;
  status: RunStatus;
  canManage: boolean;
  variant?: "desk" | "plant";
}) {
  const router = useRouter();
  const plant = variant === "plant";
  const [freezers, setFreezers] = useState<string[]>(["F1", "F2"]);
  const [time, setTime] = useState("");
  const [askFreezing, setAskFreezing] = useState(false);
  // Sin señal el cambio queda en la cola de la tablet y se envía al volver la conexión (idempotente por clientId).
  const offline = useOfflineAction(OFFLINE_ACTION.runStatus, setRunStatusAction, {
    success: "Estado actualizado",
    onSuccess: (_d, queued) => {
      setAskFreezing(false);
      if (!queued) router.refresh();
    },
  });
  const change = {
    pending: offline.pending,
    run: (i: { runId: string; status: string; freezerCodes?: ("F1" | "F2")[]; frozenTime?: string | null }) =>
      offline.run({
        ...i,
        status: i.status as SetRunStatusPayload["status"],
        clientId: crypto.randomUUID(),
        recordedAt: new Date().toISOString(),
      }),
  };
  const queued = useQueuedItems<SetRunStatusPayload>(OFFLINE_ACTION.runStatus).filter(
    (q) => q.payload.runId === runId,
  );
  if (queued.length)
    return (
      <p
        className={cn(
          "flex items-center gap-2 rounded-lg border border-amber-500 bg-amber-50 p-3 font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
          plant ? "text-lg" : "text-sm",
        )}
        role="status"
        data-testid="status-pending"
      >
        <CloudOff className="size-4" /> Cambio de estado guardado en este equipo, pendiente de enviar.
      </p>
    );
  const next = nextRunStatuses(status).filter((s) => canManage || (s !== "closed" && s !== "cancelled"));
  if (!next.length) return null;
  const size = plant ? "lg" : "default";
  const big = plant ? "h-16 text-xl" : undefined;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {next.map((s) => {
          if (s === "cancelled") {
            return (
              <AlertDialog key={s}>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size={size} className={big}>
                    {RUN_STATUS_ACTION[s]}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Cancelar la producción?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Queda cancelada y ya no se puede cargar nada. Los consumos ya registrados siguen en el
                      stock.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Volver</AlertDialogCancel>
                    <AlertDialogAction onClick={() => change.run({ runId, status: "cancelled" })}>
                      Sí, cancelar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            );
          }
          if (s === "freezing") {
            return (
              <Button key={s} size={size} className={big} onClick={() => setAskFreezing((v) => !v)}>
                {RUN_STATUS_ACTION[s]}
              </Button>
            );
          }
          return (
            <Button
              key={s}
              size={size}
              className={big}
              disabled={change.pending}
              onClick={() => change.run({ runId, status: s as "in_progress" | "packed" | "closed" })}
            >
              {RUN_STATUS_ACTION[s]}
            </Button>
          );
        })}
      </div>
      {askFreezing ? (
        <div className="grid gap-3 rounded-lg border p-3" role="group" aria-label="Datos del congelado">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("text-sm font-medium", plant && "text-lg")}>Abatidor:</span>
            {FREEZER_CODES.map((f) => (
              <Button
                key={f}
                type="button"
                variant={freezers.includes(f) ? "default" : "outline"}
                size={size}
                className={cn(big, "min-w-20")}
                aria-pressed={freezers.includes(f)}
                onClick={() =>
                  setFreezers((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))
                }
              >
                {f}
              </Button>
            ))}
            <label className={cn("ml-2 flex items-center gap-2 text-sm", plant && "text-lg")}>
              Hora de entrada
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={cn("w-32", plant && "h-16 text-xl")}
              />
            </label>
          </div>
          <Button
            size={size}
            className={cn(big, "w-fit")}
            disabled={change.pending || freezers.length === 0}
            onClick={() =>
              change.run({
                runId,
                status: "freezing",
                freezerCodes: freezers as ("F1" | "F2")[],
                frozenTime: time || null,
              })
            }
          >
            Confirmar congelado
          </Button>
        </div>
      ) : null}
    </div>
  );
}
