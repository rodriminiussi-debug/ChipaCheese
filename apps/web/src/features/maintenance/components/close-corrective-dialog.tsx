"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useAction } from "@/hooks/use-action";
import { closeCorrectiveAction } from "../actions";

/** Cerrar una orden correctiva con lo que se hizo, repuesto, costo y tiempo de parada. */
export function CloseCorrectiveDialog({
  id,
  equipmentName,
  activity,
  today,
}: {
  id: string;
  equipmentName: string;
  activity: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [doneAt, setDoneAt] = useState(today);
  const [done, setDone] = useState(activity);
  const [spareParts, setSpareParts] = useState("");
  const [cost, setCost] = useState("");
  const [downtime, setDowntime] = useState("");
  const save = useAction(closeCorrectiveAction, {
    success: "Orden cerrada",
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });
  const fe = save.fieldErrors;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" aria-label={`Cerrar orden: ${equipmentName} · ${activity}`}>
          <CheckCheck /> Cerrar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cerrar orden correctiva</DialogTitle>
          <DialogDescription>{equipmentName}</DialogDescription>
        </DialogHeader>
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field className="sm:col-span-2" data-invalid={!!fe.activity}>
            <FieldLabel htmlFor="cc-activity">Qué se hizo</FieldLabel>
            <Input id="cc-activity" value={done} onChange={(e) => setDone(e.target.value)} />
            <FieldError>{fe.activity?.[0]}</FieldError>
          </Field>
          <Field data-invalid={!!fe.doneAt}>
            <FieldLabel htmlFor="cc-date">Fecha de cierre</FieldLabel>
            <Input
              id="cc-date"
              type="date"
              max={today}
              value={doneAt}
              onChange={(e) => setDoneAt(e.target.value)}
            />
            <FieldError>{fe.doneAt?.[0]}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="cc-parts">Repuesto</FieldLabel>
            <Input id="cc-parts" value={spareParts} onChange={(e) => setSpareParts(e.target.value)} />
          </Field>
          <Field data-invalid={!!fe.cost}>
            <FieldLabel htmlFor="cc-cost">Costo ($)</FieldLabel>
            <Input id="cc-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
            <FieldError>{fe.cost?.[0]}</FieldError>
          </Field>
          <Field data-invalid={!!fe.downtimeMinutes}>
            <FieldLabel htmlFor="cc-downtime">Tiempo de parada (min)</FieldLabel>
            <Input
              id="cc-downtime"
              type="number"
              inputMode="numeric"
              min={0}
              value={downtime}
              onChange={(e) => setDowntime(e.target.value)}
            />
            <FieldError>{fe.downtimeMinutes?.[0]}</FieldError>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button
            disabled={save.pending}
            onClick={() =>
              void save.run({
                id,
                doneAt,
                activity: done,
                spareParts: spareParts.trim() || null,
                cost,
                downtimeMinutes: downtime,
              })
            }
          >
            Cerrar orden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
