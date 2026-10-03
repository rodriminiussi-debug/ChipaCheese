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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { registerPreventiveAction } from "../actions";

const NONE = "__none__";

/** Registrar un preventivo hecho: crea la orden cerrada y mueve el próximo vencimiento del plan. */
export function PreventiveDialog({
  planId,
  task,
  equipmentName,
  today,
  people,
}: {
  planId: string;
  task: string;
  equipmentName: string;
  today: string;
  people: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [supervisorId, setSupervisorId] = useState(NONE);
  const [spareParts, setSpareParts] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const save = useAction(registerPreventiveAction, {
    success: "Preventivo registrado",
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });
  const fe = save.fieldErrors;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" aria-label={`Registrar hecho: ${equipmentName} · ${task}`}>
          <CheckCheck /> Registrar hecho
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar preventivo hecho</DialogTitle>
          <DialogDescription>
            {equipmentName} · {task}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field data-invalid={!!fe.date}>
            <FieldLabel htmlFor="pv-date">Fecha en que se hizo</FieldLabel>
            <Input
              id="pv-date"
              type="date"
              max={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <FieldError>{fe.date?.[0]}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="pv-supervisor">Supervisor</FieldLabel>
            <Select value={supervisorId} onValueChange={setSupervisorId}>
              <SelectTrigger id="pv-supervisor" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sin supervisor</SelectItem>
                {people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="pv-parts">Repuestos usados</FieldLabel>
            <Input id="pv-parts" value={spareParts} onChange={(e) => setSpareParts(e.target.value)} />
          </Field>
          <Field data-invalid={!!fe.cost}>
            <FieldLabel htmlFor="pv-cost">Costo ($)</FieldLabel>
            <Input id="pv-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
            <FieldError>{fe.cost?.[0]}</FieldError>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="pv-notes">Observaciones</FieldLabel>
            <Input id="pv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button
            disabled={save.pending}
            onClick={() =>
              void save.run({
                planId,
                date,
                supervisorId: supervisorId === NONE ? null : supervisorId,
                spareParts: spareParts.trim() || null,
                cost,
                notes: notes.trim() || null,
              })
            }
          >
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
