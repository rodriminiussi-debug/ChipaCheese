"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, X } from "lucide-react";
import { checkConsumption, formatDateAR, parseDecimalAR, parseRawLotQr, roundQty } from "@chipa/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/app/native-select";
import { StatusBadge } from "@/components/app/status-badge";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { recordConsumptionsAction } from "../actions";
import { CONSUMPTION_REASON } from "../labels";
import { fmtQty, fmtRange, UNIT_SHORT } from "../format";
import type { ConsumptionSuggestion } from "../service";
import { LotScanField } from "./lot-scan-field";

type Line = { rawLotId: string; qty: string };

/**
 * Consumos reales (RF-20 / Regla 2): precarga el teórico de la receta repartido por FEFO entre los lotes
 * con saldo; se puede cambiar el real y elegir otro lote. Avisa en pantalla cuando el total de un insumo
 * queda fuera del rango o del umbral. `variant="plant"`: inputs y botones grandes para la tablet.
 */
export function ConsumptionForm({
  runId,
  suggestions,
  thresholdPct,
  variant = "desk",
  replacing = false,
}: {
  runId: string;
  suggestions: ConsumptionSuggestion[];
  thresholdPct: number;
  variant?: "desk" | "plant";
  replacing?: boolean;
}) {
  const router = useRouter();
  const plant = variant === "plant";
  const [lines, setLines] = useState<Record<string, Line[]>>(() =>
    Object.fromEntries(
      suggestions.map((s) => [
        s.ingredientId,
        s.lines.map((l) => ({ rawLotId: l.rawLotId ?? "", qty: String(l.qty).replace(".", ",") })),
      ]),
    ),
  );
  const save = useAction(recordConsumptionsAction, {
    success: (d) =>
      d.outOfRange > 0 ? `Consumos registrados: ${d.outOfRange} fuera de rango` : "Consumos registrados",
    onSuccess: () => router.refresh(),
  });

  // Insumos cuyo lote ya se eligió escaneando: el siguiente escaneo del mismo insumo agrega otro lote.
  const [scanned, setScanned] = useState<Set<string>>(() => new Set());

  /** RF-11: selecciona el lote que leyó el lector de QR (el texto es el id del lote). */
  function scan(text: string): { ok: boolean; message: string } {
    const rawLotId = parseRawLotQr(text);
    if (!rawLotId) return { ok: false, message: "No es el QR de un lote de materia prima." };
    const s = suggestions.find((x) => x.lots.some((l) => l.rawLotId === rawLotId));
    const lot = s?.lots.find((l) => l.rawLotId === rawLotId);
    if (!s || !lot)
      return { ok: false, message: "Ese lote no tiene saldo o no es de un insumo de esta receta." };
    if ((lines[s.ingredientId] ?? []).some((l) => l.rawLotId === rawLotId))
      return { ok: true, message: `${s.name}: el lote ${lot.code} ya estaba seleccionado.` };
    setLines((all) => {
      const rows = all[s.ingredientId] ?? [];
      return {
        ...all,
        [s.ingredientId]:
          rows.length && !scanned.has(s.ingredientId)
            ? rows.map((l, j) => (j === 0 ? { ...l, rawLotId } : l))
            : [...rows, { rawLotId, qty: "" }],
      };
    });
    setScanned((prev) => new Set(prev).add(s.ingredientId));
    return { ok: true, message: `${s.name}: lote ${lot.code} seleccionado.` };
  }

  const update = (id: string, i: number, patch: Partial<Line>) =>
    setLines((all) => ({ ...all, [id]: all[id]!.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  function submit() {
    save.run({
      runId,
      lines: suggestions.flatMap((s) =>
        (lines[s.ingredientId] ?? []).map((l) => ({
          ingredientId: s.ingredientId,
          rawLotId: l.rawLotId || null,
          qty: parseDecimalAR(l.qty) ?? 0,
        })),
      ),
    });
  }

  return (
    <div className="grid gap-3">
      {!plant ? <LotScanField onScan={scan} /> : null}
      {suggestions.map((s) => {
        const unit = UNIT_SHORT[s.unit] ?? "";
        const rows = lines[s.ingredientId] ?? [];
        const total = roundQty(rows.reduce((a, l) => a + (parseDecimalAR(l.qty) ?? 0), 0));
        const check = checkConsumption({
          theoretical: s.theoretical,
          actual: total,
          min: s.min,
          max: s.max,
          thresholdPct,
        });
        const out = total > 0 && !check.ok;
        return (
          <fieldset
            key={s.ingredientId}
            className={cn(
              "rounded-lg border p-3",
              out && "border-amber-500 bg-amber-50 dark:bg-amber-950/30",
              plant && "p-4",
            )}
            data-out-of-range={out || undefined}
          >
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <legend className={cn("font-semibold", plant && "text-xl")}>{s.name}</legend>
              <span className={cn("text-muted-foreground text-sm", plant && "text-base")}>
                Teórico {fmtQty(s.theoretical)} {unit}
                {s.min != null || s.max != null ? ` · Rango ${fmtRange(s.min, s.max, unit)}` : ""}
                {` · Stock ${fmtQty(s.available)} ${unit}`}
              </span>
            </div>
            <div className="grid gap-2">
              {rows.map((l, i) => {
                const lot = s.lots.find((x) => x.rawLotId === l.rawLotId);
                const qty = parseDecimalAR(l.qty) ?? 0;
                const suffix = i > 0 ? ` (lote ${i + 1})` : "";
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_8rem_auto] items-center gap-2 sm:grid-cols-[1fr_10rem_auto]"
                  >
                    <NativeSelect
                      aria-label={`Lote de ${s.name}${suffix}`}
                      className={plant ? "h-14 text-lg" : undefined}
                      value={l.rawLotId}
                      onChange={(e) => update(s.ingredientId, i, { rawLotId: e.target.value })}
                    >
                      <option value="">Sin lote</option>
                      {s.lots.map((x) => (
                        <option key={x.rawLotId} value={x.rawLotId}>
                          {x.code}
                          {x.expiryDate ? ` · vence ${formatDateAR(x.expiryDate)}` : ""} · quedan{" "}
                          {fmtQty(x.qty)}
                        </option>
                      ))}
                    </NativeSelect>
                    <div className="flex items-center gap-1">
                      <Input
                        inputMode="decimal"
                        aria-label={`Real de ${s.name}${suffix}`}
                        className={cn("text-right tabular-nums", plant && "h-16 text-2xl")}
                        value={l.qty}
                        onChange={(e) => update(s.ingredientId, i, { qty: e.target.value })}
                      />
                      <span className={cn("text-muted-foreground w-6 text-sm", plant && "text-lg")}>
                        {unit}
                      </span>
                    </div>
                    {i > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Quitar lote ${i + 1} de ${s.name}`}
                        onClick={() =>
                          setLines((all) => ({
                            ...all,
                            [s.ingredientId]: all[s.ingredientId]!.filter((_, j) => j !== i),
                          }))
                        }
                      >
                        <X />
                      </Button>
                    ) : (
                      <span />
                    )}
                    {lot && qty > lot.qty ? (
                      <p className="col-span-3 text-xs text-amber-700 dark:text-amber-400">
                        Ese lote tiene {fmtQty(lot.qty)} {unit}: el stock va a quedar negativo.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setLines((all) => ({
                    ...all,
                    [s.ingredientId]: [...(all[s.ingredientId] ?? []), { rawLotId: "", qty: "" }],
                  }))
                }
              >
                <Plus /> Agregar otro lote de {s.name.toLowerCase()}
              </Button>
              {out ? (
                <StatusBadge tone="warn" className="gap-1">
                  <AlertTriangle className="size-3.5" />
                  Fuera de rango: {fmtQty(total)} {unit} — {CONSUMPTION_REASON[check.reason]}
                  {check.reason === "over_threshold" ? ` (${fmtQty(check.pct, 1)} %)` : ""}
                </StatusBadge>
              ) : null}
            </div>
          </fieldset>
        );
      })}
      <Button
        type="button"
        size={plant ? "lg" : "default"}
        className={cn(plant && "h-16 text-xl")}
        disabled={save.pending}
        onClick={submit}
      >
        {replacing ? "Corregir consumos" : "Confirmar consumos"}
      </Button>
    </div>
  );
}
