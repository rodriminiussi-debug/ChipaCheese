"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, CloudOff, Delete, Siren, Thermometer } from "lucide-react";
import { parseDecimalAR, temperatureStatus } from "@chipa/domain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OFFLINE_ACTION } from "@/components/pwa/offline-actions";
import { useOfflineAction } from "@/hooks/use-offline-action";
import { cn } from "@/lib/utils";
import { recordTemperatureAction } from "../actions";
import { rangeLabel, tempLabel } from "../labels";

export interface EquipmentView {
  id: string;
  code: string;
  name: string;
  min: number | null;
  max: number | null;
  /** Última lectura (de cualquier día). */
  lastValue: number | null;
  lastLabel: string | null;
  lastOut: boolean;
  /** Ya tiene lectura hoy. */
  doneToday: boolean;
  /** Falta la lectura del día. */
  missing: boolean;
}

const QUICK_ACTIONS = [
  "Se cerró la puerta y se volvió a medir",
  "Se avisó a la jefa de producción",
  "Se llamó al técnico",
  "Se pasó la mercadería a otro freezer",
];

const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3"];

/**
 * Carga de temperaturas en la tablet (RF-34, RF-38): elegir equipo con botones grandes, teclado numérico
 * grande con signo negativo y, si el valor está fuera de rango, alerta roja + acción correctiva obligatoria.
 */
export function TemperaturePad({ equipment }: { equipment: EquipmentView[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<EquipmentView | null>(null);
  const [raw, setRaw] = useState("");
  const [action, setAction] = useState("");
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  const [last, setLast] = useState<{ code: string; value: number; out: boolean; queued: boolean } | null>(
    null,
  );
  const pendingInfo = useRef<{ code: string; value: number; out: boolean; id: string } | null>(null);

  const { run, pending } = useOfflineAction(OFFLINE_ACTION.temperature, recordTemperatureAction, {
    onSuccess: (_d, queued) => {
      const info = pendingInfo.current;
      if (info) {
        setLast({ code: info.code, value: info.value, out: info.out, queued });
        if (queued) setQueuedIds((s) => new Set(s).add(info.id));
      }
      setSelected(null);
      setRaw("");
      setAction("");
      if (!queued) router.refresh();
    },
  });

  const normalized = raw.endsWith(",") ? raw.slice(0, -1) : raw;
  const value = normalized === "" || normalized === "-" ? null : parseDecimalAR(normalized);
  const status = selected && value != null ? temperatureStatus(value, selected) : null;
  const out = status != null && status !== "ok";
  const canSave = selected != null && value != null && (!out || action.trim().length >= 3);

  function press(k: string) {
    setRaw((r) => (r.replace("-", "").replace(",", "").length >= 4 ? r : r + k));
  }
  function comma() {
    setRaw((r) => (r.includes(",") ? r : (r.replace("-", "") === "" ? r + "0" : r) + ","));
  }
  function sign() {
    setRaw((r) => (r.startsWith("-") ? r.slice(1) : "-" + r));
  }

  function save() {
    if (!selected || value == null) return;
    pendingInfo.current = { code: selected.code, value, out, id: selected.id };
    run({
      clientId: crypto.randomUUID(),
      recordedAt: new Date().toISOString(),
      equipmentId: selected.id,
      valueC: value,
      correctiveAction: out ? action.trim() : null,
    });
  }

  if (!selected) {
    return (
      <div className="space-y-4">
        {last ? (
          last.out ? (
            <Alert variant="destructive" className="border-2 p-4" data-testid="saved-alert">
              <Siren className="size-6" />
              <AlertTitle className="text-xl">
                ALERTA: {last.code} fuera de rango ({tempLabel(last.value)})
              </AlertTitle>
              <AlertDescription className="text-lg">
                {last.queued ? "Quedó en la cola y se enviará al volver la señal. " : "Quedó registrada. "}
                Avisá a la jefa de producción.
              </AlertDescription>
            </Alert>
          ) : (
            <p
              className="flex items-center gap-2 text-xl font-semibold text-emerald-700"
              data-testid="saved-ok"
            >
              <Check className="size-6" /> {last.code}: {tempLabel(last.value)} registrada
              {last.queued ? " (en cola)" : ""}
            </p>
          )
        ) : null}
        <h2 className="text-2xl font-bold">¿Qué equipo medís?</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {equipment.map((e) => {
            const queued = queuedIds.has(e.id);
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  setSelected(e);
                  setRaw("");
                  setAction("");
                }}
                className={cn(
                  "bg-card hover:bg-accent flex min-h-28 flex-col items-start justify-center gap-1 rounded-xl border-2 p-4 text-left shadow-sm",
                  e.missing && "border-amber-400",
                  e.lastOut && "border-destructive",
                )}
              >
                <span className="flex items-center gap-2 text-2xl font-bold">
                  <Thermometer className="size-7" /> {e.code}
                </span>
                <span className="text-muted-foreground text-lg">{e.name}</span>
                <span className="text-base">
                  {queued ? (
                    <span className="flex items-center gap-1 font-medium">
                      <CloudOff className="size-4" /> En cola
                    </span>
                  ) : e.doneToday ? (
                    <span className="font-medium text-emerald-700">Hoy ✓ {e.lastLabel}</span>
                  ) : e.missing ? (
                    <span className="font-medium text-amber-700">
                      Falta hoy · {e.lastLabel ?? "sin lecturas"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{e.lastLabel ?? "sin lecturas"}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Button
        type="button"
        variant="ghost"
        className="h-14 text-xl"
        onClick={() => setSelected(null)}
        disabled={pending}
      >
        <ArrowLeft className="size-6" /> Cambiar equipo
      </Button>
      <div>
        <h2 className="text-3xl font-bold">
          {selected.code} <span className="text-muted-foreground text-xl font-normal">{selected.name}</span>
        </h2>
        <p className="text-muted-foreground text-lg">Rango: {rangeLabel(selected.min, selected.max)}</p>
      </div>

      <div
        data-testid="temp-display"
        aria-live="polite"
        className={cn(
          "flex h-24 items-center justify-end rounded-xl border-2 px-6 text-6xl font-bold tabular-nums",
          out && "border-destructive bg-red-50 text-red-700 dark:bg-red-950/40",
        )}
      >
        {raw === "" ? <span className="text-muted-foreground">—</span> : raw.replace("-", "−")}
        <span className="text-muted-foreground ml-2 text-3xl">°C</span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <Button key={k} type="button" variant="outline" className="h-20 text-4xl" onClick={() => press(k)}>
            {k}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          className="h-20 text-4xl"
          aria-label="Signo menos"
          onClick={sign}
        >
          ±
        </Button>
        <Button type="button" variant="outline" className="h-20 text-4xl" onClick={() => press("0")}>
          0
        </Button>
        <Button type="button" variant="outline" className="h-20 text-4xl" aria-label="Coma" onClick={comma}>
          ,
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="col-span-3 h-16 text-xl"
          aria-label="Borrar"
          onClick={() => setRaw((r) => r.slice(0, -1))}
        >
          <Delete className="size-6" /> Borrar
        </Button>
      </div>

      {out ? (
        <Alert variant="destructive" className="space-y-3 border-2 p-4" data-testid="out-of-range-alert">
          <Siren className="size-6" />
          <AlertTitle className="text-xl">
            FUERA DE RANGO: {value != null ? tempLabel(value) : ""} (permitido{" "}
            {rangeLabel(selected.min, selected.max)})
          </AlertTitle>
          <AlertDescription className="space-y-3 text-lg">
            <p>Indicá qué hiciste para corregirlo antes de guardar.</p>
            <div className="grid gap-2">
              {QUICK_ACTIONS.map((q) => (
                <Button
                  key={q}
                  type="button"
                  variant="outline"
                  className="h-14 justify-start text-lg whitespace-normal"
                  onClick={() => setAction(q)}
                >
                  {q}
                </Button>
              ))}
            </div>
            <Input
              aria-label="Acción correctiva"
              placeholder="Acción correctiva"
              className="h-14 text-xl"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
          </AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="button"
        className={cn("h-20 w-full text-2xl", out && "bg-destructive hover:bg-destructive/90 text-white")}
        disabled={!canSave || pending}
        onClick={save}
      >
        <Check className="size-7" /> {out ? "Guardar con alerta" : "Guardar"}
      </Button>
    </div>
  );
}
