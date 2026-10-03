"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { Minus, Plus, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { recordPackingAction } from "../actions";
import type { PackingOptions } from "../service";

/**
 * Envasado desde la tablet (RF-22, modo planta): producto con botones grandes, bolsas con +/− (de a 1 y de a
 * 10), ubicación F3/F4 y un solo botón para confirmar. Objetivo: un registro en menos de 30 segundos.
 */
export function PlantPackingForm({
  runId,
  options,
  lotCode,
}: {
  runId: string;
  options: PackingOptions;
  lotCode: string;
}) {
  const router = useRouter();
  const [productId, setProductId] = useState(options.products[0]?.id ?? "");
  const [locationId, setLocationId] = useState(options.locations[0]?.id ?? "");
  const [units, setUnits] = useState(0);
  const [done, setDone] = useState<{ lotCode: string; units: number; product: string } | null>(null);
  const product = options.products.find((p) => p.id === productId);
  const save = useAction(recordPackingAction, {
    success: (d) => `Envasado registrado: ${d.units} u. en el lote ${d.lotCode}`,
    onSuccess: (d) => {
      setDone({ lotCode: d.lotCode, units, product: product?.name ?? "" });
      setUnits(0);
      router.refresh();
    },
  });
  const bump = (n: number) => setUnits((u) => Math.max(0, Math.min(5000, u + n)));

  return (
    <div className="grid gap-5">
      <div className="grid gap-2" role="group" aria-label="Producto">
        <p className="text-xl font-semibold">Producto</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.products.map((p) => (
            <Button
              key={p.id}
              type="button"
              variant={p.id === productId ? "default" : "outline"}
              aria-pressed={p.id === productId}
              className="h-16 justify-start text-lg whitespace-normal"
              onClick={() => setProductId(p.id)}
            >
              {p.name}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <p className="text-xl font-semibold" id="units-label">
          Bolsas
        </p>
        <div className="flex items-center gap-2" role="group" aria-labelledby="units-label">
          <Button
            type="button"
            variant="outline"
            className="h-16 w-20 text-xl"
            aria-label="Restar 10"
            onClick={() => bump(-10)}
          >
            −10
          </Button>
          <Button
            type="button"
            variant="outline"
            className="size-16"
            aria-label="Restar 1"
            onClick={() => bump(-1)}
          >
            <Minus className="size-7" />
          </Button>
          <output
            aria-label="Bolsas a registrar"
            className="bg-card flex h-16 min-w-28 flex-1 items-center justify-center rounded-lg border text-4xl font-bold tabular-nums"
          >
            {units}
          </output>
          <Button
            type="button"
            variant="outline"
            className="size-16"
            aria-label="Sumar 1"
            onClick={() => bump(1)}
          >
            <Plus className="size-7" />
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-16 w-20 text-xl"
            aria-label="Sumar 10"
            onClick={() => bump(10)}
          >
            +10
          </Button>
        </div>
      </div>

      <div className="grid gap-2" role="group" aria-label="Ubicación">
        <p className="text-xl font-semibold">Guardar en</p>
        <div className="flex gap-2">
          {options.locations.map((l) => (
            <Button
              key={l.id}
              type="button"
              variant={l.id === locationId ? "default" : "outline"}
              aria-pressed={l.id === locationId}
              className={cn("h-16 min-w-28 flex-1 text-2xl")}
              onClick={() => setLocationId(l.id)}
            >
              {l.code}
            </Button>
          ))}
        </div>
      </div>

      <Button
        type="button"
        size="lg"
        className="h-20 text-2xl"
        disabled={save.pending || units <= 0 || !productId || !locationId}
        onClick={() => save.run({ runId, items: [{ productId, units, locationId }] })}
      >
        Confirmar envasado{units > 0 ? ` (${units})` : ""}
      </Button>

      {done ? (
        <div className="bg-card grid gap-2 rounded-xl border p-4" role="status">
          <p className="text-lg">
            Registrado: <strong>{done.units} bolsas</strong> de {done.product} en el lote{" "}
            <strong>{done.lotCode}</strong>
          </p>
          <Button variant="outline" className="h-14 w-fit text-lg" asChild>
            <Link
              href={
                `/produccion/lotes/${done.lotCode}/etiqueta?producto=${productId}&copias=${done.units}` as Route
              }
            >
              <Printer /> Imprimir etiquetas
            </Link>
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-base">Lote de esta producción: {lotCode}</p>
      )}
    </div>
  );
}
