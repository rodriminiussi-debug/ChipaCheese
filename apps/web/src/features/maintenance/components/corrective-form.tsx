"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { createCorrectiveAction, updateCorrectiveAction } from "../actions";
import { correctiveInput, type CorrectiveData, type CorrectiveInput } from "../schemas";
import type { MaintenanceFormOptions } from "../service";

const NONE = "__none__";

/** Orden de trabajo correctiva: equipo, causa, actividad, repuesto, costo, parada, responsable y supervisor. */
export function CorrectiveForm({
  options,
  today,
  initial,
  defaultEquipmentId,
}: {
  options: MaintenanceFormOptions;
  today: string;
  initial?: CorrectiveInput & { id: string };
  defaultEquipmentId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const blank = (): CorrectiveInput => ({
    equipmentId: defaultEquipmentId ?? "",
    date: today,
    cause: "",
    activity: "",
    closed: false,
  });
  const form = useForm<CorrectiveInput, unknown, CorrectiveData>({
    resolver: zodResolver(correctiveInput),
    defaultValues: initial ?? blank(),
  });
  const done = () => {
    setOpen(false);
    if (!initial) form.reset(blank());
    router.refresh();
  };
  const create = useAction(createCorrectiveAction, {
    success: "Orden correctiva registrada",
    onSuccess: done,
  });
  const update = useAction(updateCorrectiveAction, { success: "Orden actualizada", onSuccess: done });
  const serverErrors = initial ? update.fieldErrors : create.fieldErrors;
  const err = (n: keyof CorrectiveInput) => form.formState.errors[n]?.message ?? serverErrors[n]?.[0];
  const onSubmit = form.handleSubmit((d) => (initial ? update.run({ ...d, id: initial.id }) : create.run(d)));

  const personSelect = (name: "responsibleId" | "supervisorId", label: string, none: string) => (
    <Field>
      <FieldLabel htmlFor={`co-${name}`}>{label}</FieldLabel>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
            <SelectTrigger id={`co-${name}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{none}</SelectItem>
              {options.people.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {initial ? (
          <Button variant="ghost" size="icon" aria-label="Editar orden correctiva">
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus /> Nueva orden correctiva
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar orden correctiva" : "Nueva orden correctiva"}</DialogTitle>
          <DialogDescription>Falla o reparación no programada.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!err("equipmentId")}>
              <FieldLabel htmlFor="co-equipment">Equipo *</FieldLabel>
              <Controller
                control={form.control}
                name="equipmentId"
                render={({ field }) => (
                  <Select value={field.value ?? ""} onValueChange={field.onChange}>
                    <SelectTrigger id="co-equipment" className="w-full">
                      <SelectValue placeholder="Elegí el equipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {options.equipment.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name} · {e.area}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError>{err("equipmentId")}</FieldError>
            </Field>
            <Field data-invalid={!!err("date")}>
              <FieldLabel htmlFor="co-date">Fecha *</FieldLabel>
              <Input id="co-date" type="date" max={today} {...form.register("date")} />
              <FieldError>{err("date")}</FieldError>
            </Field>
            <Field data-invalid={!!err("cause")}>
              <FieldLabel htmlFor="co-cause">Causa *</FieldLabel>
              <Input id="co-cause" placeholder="Ej.: alambre cortado" {...form.register("cause")} />
              <FieldError>{err("cause")}</FieldError>
            </Field>
            <Field data-invalid={!!err("activity")}>
              <FieldLabel htmlFor="co-activity">Actividad *</FieldLabel>
              <Input id="co-activity" placeholder="Ej.: cambio de alambre" {...form.register("activity")} />
              <FieldError>{err("activity")}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="co-parts">Repuesto</FieldLabel>
              <Input id="co-parts" {...form.register("spareParts")} />
            </Field>
            <Field data-invalid={!!err("cost")}>
              <FieldLabel htmlFor="co-cost">Costo ($)</FieldLabel>
              <Input id="co-cost" inputMode="decimal" {...form.register("cost")} />
              <FieldError>{err("cost")}</FieldError>
            </Field>
            <Field data-invalid={!!err("downtimeMinutes")}>
              <FieldLabel htmlFor="co-downtime">Tiempo de parada (min)</FieldLabel>
              <Input
                id="co-downtime"
                type="number"
                inputMode="numeric"
                min={0}
                {...form.register("downtimeMinutes")}
              />
              <FieldError>{err("downtimeMinutes")}</FieldError>
            </Field>
            <div className="hidden sm:block" />
            {personSelect("responsibleId", "Responsable", "Yo (quien registra)")}
            {personSelect("supervisorId", "Supervisor", "Sin supervisor")}
            <Field orientation="horizontal" className="sm:col-span-2">
              <Controller
                control={form.control}
                name="closed"
                render={({ field }) => (
                  <Switch id="co-closed" checked={field.value ?? false} onCheckedChange={field.onChange} />
                )}
              />
              <FieldLabel htmlFor="co-closed">Ya está resuelta (cargar como cerrada)</FieldLabel>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={create.pending || update.pending}>
              {initial ? "Guardar cambios" : "Registrar orden"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
