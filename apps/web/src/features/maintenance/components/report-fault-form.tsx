"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { CheckCircle2, OctagonAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { reportFaultAction } from "../actions";
import type { FaultEquipmentOption } from "../service";

const QUICK = [
  "No enfría",
  "No arranca",
  "Hace ruido raro",
  "Pierde líquido",
  "Se trabó",
  "Salta el térmico",
];

/**
 * Aviso de falla con botones grandes (tablet con guantes o celular): elegir el equipo (incluye el equipo de
 * frío del vehículo y los freezers), contar qué pasa y si está parado. Crea una correctiva abierta que
 * Mantenimiento ve como "Avisada por X".
 */
export function ReportFaultForm({
  equipment,
  defaultEquipmentId,
  backHref,
}: {
  equipment: FaultEquipmentOption[];
  defaultEquipmentId?: string | null;
  backHref: string;
}) {
  const [equipmentId, setEquipmentId] = useState(
    equipment.some((e) => e.id === defaultEquipmentId) ? (defaultEquipmentId ?? "") : "",
  );
  const [description, setDescription] = useState("");
  const [stopped, setStopped] = useState<boolean | null>(null);
  const [done, setDone] = useState<{ equipmentName: string; stopped: boolean } | null>(null);
  const report = useAction(reportFaultAction, {
    onSuccess: (r) => setDone({ equipmentName: r.equipmentName, stopped: r.stopped }),
  });

  const areas = [...new Set(equipment.map((e) => e.area))];
  const ready = equipmentId !== "" && description.trim().length >= 3 && stopped !== null;

  if (done)
    return (
      <div className="grid gap-4" data-testid="fault-done">
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border-2 border-emerald-600 bg-emerald-50 p-5 text-2xl font-semibold text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          <CheckCircle2 className="size-10 shrink-0" />
          Aviso enviado: {done.equipmentName}
        </div>
        <p className="text-xl">
          Mantenimiento ya lo ve en su lista.
          {done.stopped ? " Como el equipo está parado, avisale también a la jefa de producción." : ""}
        </p>
        <Button asChild size="lg" className="h-16 w-fit text-xl">
          <Link href={backHref as Route}>Listo</Link>
        </Button>
      </div>
    );

  return (
    <div className="grid gap-6">
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-xl font-semibold">¿Qué equipo tiene la falla?</legend>
        {areas.map((area) => (
          <div key={area} className="grid gap-2">
            <p className="text-muted-foreground text-base font-medium">{area}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {equipment
                .filter((e) => e.area === area)
                .map((e) => (
                  <Button
                    key={e.id}
                    type="button"
                    variant={equipmentId === e.id ? "default" : "outline"}
                    aria-pressed={equipmentId === e.id}
                    className="h-16 justify-start text-left text-xl whitespace-normal"
                    onClick={() => setEquipmentId(e.id)}
                  >
                    <Wrench className="size-6 shrink-0" /> {e.name}
                  </Button>
                ))}
            </div>
          </div>
        ))}
        {report.fieldErrors.equipmentId?.[0] ? (
          <p className="text-destructive text-lg">{report.fieldErrors.equipmentId[0]}</p>
        ) : null}
      </fieldset>

      <div className="grid gap-2">
        <Label htmlFor="fault-description" className="text-xl font-semibold">
          ¿Qué pasa?
        </Label>
        <div className="flex flex-wrap gap-2">
          {QUICK.map((q) => (
            <Button
              key={q}
              type="button"
              variant="outline"
              className="h-12 text-lg"
              onClick={() => setDescription((d) => (d.trim() ? `${d.trim()}. ${q}` : q))}
            >
              {q}
            </Button>
          ))}
        </div>
        <Textarea
          id="fault-description"
          rows={3}
          className="text-xl md:text-xl"
          placeholder="Contalo con tus palabras"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-invalid={!!report.fieldErrors.description?.[0]}
        />
        {report.fieldErrors.description?.[0] ? (
          <p className="text-destructive text-lg">{report.fieldErrors.description[0]}</p>
        ) : null}
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-xl font-semibold">¿Está parado?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            variant={stopped === false ? "default" : "outline"}
            aria-pressed={stopped === false}
            className="h-16 text-xl"
            onClick={() => setStopped(false)}
          >
            Sigue funcionando
          </Button>
          <Button
            type="button"
            variant={stopped === true ? "destructive" : "outline"}
            aria-pressed={stopped === true}
            className={cn("h-16 text-xl", stopped !== true && "text-destructive")}
            onClick={() => setStopped(true)}
          >
            <OctagonAlert className="size-6" /> Está parado
          </Button>
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button
          size="lg"
          className="h-16 text-xl"
          disabled={!ready || report.pending}
          onClick={() => report.run({ equipmentId, description, stopped: stopped === true })}
        >
          Avisar la falla
        </Button>
        <Button asChild size="lg" variant="outline" className="h-16 text-xl">
          <Link href={backHref as Route}>Cancelar</Link>
        </Button>
      </div>
    </div>
  );
}
