"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/app/native-select";
import { OFFLINE_ACTION } from "@/components/pwa/offline-actions";
import { useOfflineAction } from "@/hooks/use-offline-action";
import { recordPackingAction } from "../actions";
import type { PackingOptions } from "../service";

type Row = { productId: string; units: string; locationId: string };

/** Envasado (RF-22): bolsas por producto y ubicación (F3/F4). La primera carga crea el lote AAMMDD-N. */
export function PackingForm({ runId, options }: { runId: string; options: PackingOptions }) {
  const router = useRouter();
  const blank = (): Row => ({
    productId: options.products[0]?.id ?? "",
    units: "",
    locationId: options.locations[0]?.id ?? "",
  });
  const [rows, setRows] = useState<Row[]>([blank()]);
  const save = useOfflineAction(OFFLINE_ACTION.packing, recordPackingAction, {
    success: (d) => `Envasado registrado en el lote ${d.lotCode}`,
    onSuccess: (_d, queued) => {
      setRows([blank()]);
      if (!queued) router.refresh();
    },
  });
  const patch = (i: number, p: Partial<Row>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const items = rows
    .map((r) => ({ productId: r.productId, locationId: r.locationId, units: Number(r.units) }))
    .filter((r) => r.units > 0);

  return (
    <div className="grid gap-3">
      {rows.map((r, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_6rem] items-center gap-2 sm:grid-cols-[1fr_7rem_8rem_auto]"
        >
          <NativeSelect
            aria-label={`Producto${rows.length > 1 ? ` ${i + 1}` : ""}`}
            value={r.productId}
            onChange={(e) => patch(i, { productId: e.target.value })}
          >
            {options.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
          <Input
            inputMode="numeric"
            placeholder="Bolsas"
            aria-label={`Unidades${rows.length > 1 ? ` ${i + 1}` : ""}`}
            className="text-right tabular-nums"
            value={r.units}
            onChange={(e) => patch(i, { units: e.target.value.replace(/\D/g, "") })}
          />
          <NativeSelect
            aria-label={`Ubicación${rows.length > 1 ? ` ${i + 1}` : ""}`}
            value={r.locationId}
            onChange={(e) => patch(i, { locationId: e.target.value })}
          >
            {options.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code}
              </option>
            ))}
          </NativeSelect>
          {rows.length > 1 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Quitar fila ${i + 1}`}
              onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
            >
              <X />
            </Button>
          ) : (
            <span />
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setRows((r) => [...r, blank()])}>
          <Plus /> Agregar producto
        </Button>
        <Button
          type="button"
          disabled={save.pending || items.length === 0}
          onClick={() =>
            save.run({ runId, items, clientId: crypto.randomUUID(), recordedAt: new Date().toISOString() })
          }
        >
          Registrar envasado
        </Button>
      </div>
    </div>
  );
}
