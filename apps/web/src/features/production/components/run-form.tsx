"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NativeSelect } from "@/components/app/native-select";
import { useAction } from "@/hooks/use-action";
import { createRunInput, type CreateRunData, type CreateRunInput } from "../schemas";
import { createRunAction } from "../actions";
import type { RunFormOptions } from "../service";

/** Alta de una producción (RF-20): fecha, turno, receta activa, kg de fécula, tandas y personas. */
export function RunForm({
  options,
  today,
  defaultResponsibleId,
}: {
  options: RunFormOptions;
  today: string;
  defaultResponsibleId: string;
}) {
  const router = useRouter();
  const form = useForm<CreateRunInput, unknown, CreateRunData>({
    resolver: zodResolver(createRunInput),
    defaultValues: {
      date: today,
      shift: "morning",
      starchKg: 75,
      batches: 2,
      responsibleId: defaultResponsibleId,
      supervisorId: null,
      workerIds: [],
      notes: "",
    },
  });
  const create = useAction(createRunAction, {
    success: (d) => `Producción N° ${d.runNumber} creada`,
    onSuccess: (d) => router.push(`/produccion/${d.id}`),
  });
  const date = form.watch("date");
  const errors = form.formState.errors;
  const err = (k: keyof CreateRunInput) => errors[k]?.message ?? create.fieldErrors[k]?.[0];
  const supervisors = options.users.filter((u) => u.role === "production_manager");

  return (
    <form onSubmit={form.handleSubmit((d) => create.run(d))} className="grid max-w-3xl gap-6" noValidate>
      {date && date < today ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Carga tardía</AlertTitle>
          <AlertDescription>
            La fecha es anterior a hoy: la producción va a quedar marcada como carga tardía (BPM).
          </AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={!!err("date")}>
          <FieldLabel htmlFor="date">Fecha de elaboración *</FieldLabel>
          <Input id="date" type="date" {...form.register("date")} />
          <FieldError>{err("date")}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="shift">Turno</FieldLabel>
          <NativeSelect id="shift" {...form.register("shift")}>
            <option value="morning">Mañana</option>
            <option value="afternoon">Tarde</option>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="recipe">Receta</FieldLabel>
          <Input
            id="recipe"
            readOnly
            value={options.recipe ? `${options.recipe.name} — versión ${options.recipe.version} (activa)` : "Sin receta activa"}
          />
          <FieldDescription>Se produce siempre con la receta activa.</FieldDescription>
        </Field>
        <Field data-invalid={!!err("starchKg")}>
          <FieldLabel htmlFor="starchKg">Kg de fécula *</FieldLabel>
          <Input id="starchKg" inputMode="decimal" {...form.register("starchKg")} />
          <FieldDescription>75 kg = una receta completa (≈ 150 kg de producto).</FieldDescription>
          <FieldError>{err("starchKg")}</FieldError>
        </Field>
        <Field data-invalid={!!err("batches")}>
          <FieldLabel htmlFor="batches">Tandas de amasado</FieldLabel>
          <Input id="batches" type="number" inputMode="numeric" min={1} max={6} {...form.register("batches")} />
          <FieldError>{err("batches")}</FieldError>
        </Field>
        <Field data-invalid={!!err("responsibleId")}>
          <FieldLabel htmlFor="responsibleId">Responsable *</FieldLabel>
          <NativeSelect id="responsibleId" {...form.register("responsibleId")}>
            {options.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
          <FieldError>{err("responsibleId")}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="supervisorId">Supervisor de registros</FieldLabel>
          <Controller
            control={form.control}
            name="supervisorId"
            render={({ field }) => (
              <NativeSelect
                id="supervisorId"
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value || null)}
              >
                <option value="">Sin supervisor</option>
                {supervisors.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel>Operarios</FieldLabel>
          <Controller
            control={form.control}
            name="workerIds"
            render={({ field }) => (
              <ToggleGroup
                type="multiple"
                variant="outline"
                className="flex-wrap justify-start"
                value={field.value ?? []}
                onValueChange={field.onChange}
              >
                {options.users.map((u) => (
                  <ToggleGroupItem key={u.id} value={u.id} aria-label={`Operario ${u.initials}`}>
                    {u.initials}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="notes">Notas</FieldLabel>
          <Textarea id="notes" rows={2} {...form.register("notes")} />
        </Field>
      </FieldGroup>
      <div className="flex gap-2">
        <Button type="submit" disabled={create.pending || !options.recipe}>
          Crear producción
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
