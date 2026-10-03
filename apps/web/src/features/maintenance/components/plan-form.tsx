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
import { createPlanAction, updatePlanAction } from "../actions";
import { planInput, type PlanData, type PlanInput } from "../schemas";
import type { MaintenanceFormOptions } from "../service";

/** Alta / edición de un plan preventivo: equipo, tarea y frecuencia en días. */
export function PlanForm({
  options,
  today,
  initial,
}: {
  options: MaintenanceFormOptions;
  today: string;
  initial?: PlanInput & { id: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<PlanInput, unknown, PlanData>({
    resolver: zodResolver(planInput),
    defaultValues: initial ?? { task: "", frequencyDays: 30, startDate: today, active: true },
  });
  const done = () => {
    setOpen(false);
    if (!initial) form.reset({ task: "", frequencyDays: 30, startDate: today, active: true });
    router.refresh();
  };
  const create = useAction(createPlanAction, { success: "Plan creado", onSuccess: done });
  const update = useAction(updatePlanAction, { success: "Plan actualizado", onSuccess: done });
  const serverErrors = initial ? update.fieldErrors : create.fieldErrors;
  const err = (n: keyof PlanInput) => form.formState.errors[n]?.message ?? serverErrors[n]?.[0];
  const onSubmit = form.handleSubmit((d) => (initial ? update.run({ ...d, id: initial.id }) : create.run(d)));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {initial ? (
          <Button variant="ghost" size="icon" aria-label="Editar plan">
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus /> Nuevo plan
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Editar plan preventivo" : "Nuevo plan preventivo"}</DialogTitle>
          <DialogDescription>
            Cada cuántos días hay que hacer la tarea. Si nunca se hizo, el primer vencimiento cuenta desde la
            fecha de alta.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2" data-invalid={!!err("equipmentId")}>
              <FieldLabel htmlFor="pl-equipment">Equipo *</FieldLabel>
              <Controller
                control={form.control}
                name="equipmentId"
                render={({ field }) => (
                  <Select value={field.value ?? ""} onValueChange={field.onChange}>
                    <SelectTrigger id="pl-equipment" className="w-full">
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
            <Field className="sm:col-span-2" data-invalid={!!err("task")}>
              <FieldLabel htmlFor="pl-task">Tarea *</FieldLabel>
              <Input
                id="pl-task"
                placeholder="Ej.: lubricación y ajuste general"
                {...form.register("task")}
              />
              <FieldError>{err("task")}</FieldError>
            </Field>
            <Field data-invalid={!!err("frequencyDays")}>
              <FieldLabel htmlFor="pl-freq">Frecuencia (días) *</FieldLabel>
              <Input
                id="pl-freq"
                type="number"
                inputMode="numeric"
                min={1}
                {...form.register("frequencyDays")}
              />
              <FieldError>{err("frequencyDays")}</FieldError>
            </Field>
            <Field data-invalid={!!err("startDate")}>
              <FieldLabel htmlFor="pl-start">Alta del plan</FieldLabel>
              <Input id="pl-start" type="date" {...form.register("startDate")} />
              <FieldError>{err("startDate")}</FieldError>
            </Field>
            {initial ? (
              <Field orientation="horizontal">
                <Controller
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <Switch id="pl-active" checked={field.value ?? true} onCheckedChange={field.onChange} />
                  )}
                />
                <FieldLabel htmlFor="pl-active">Plan activo</FieldLabel>
              </Field>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={create.pending || update.pending}>
              {initial ? "Guardar cambios" : "Crear plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
