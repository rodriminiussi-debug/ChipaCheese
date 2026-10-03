"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { recipeVersionInput, type RecipeVersionData, type RecipeVersionInput } from "../schemas";
import { createRecipeVersionAction } from "../actions";
import { UNIT_SHORT } from "../format";

export interface RecipeIngredientOption {
  id: string;
  name: string;
  unit: string;
}

/**
 * Nueva versión de la receta (RF-18): arranca como copia editable de la activa. Nunca se edita una
 * versión ya usada: cada cambio es una versión nueva con sus notas, que se activa cuando se valida.
 */
export function RecipeVersionForm({
  options,
  initial,
  baseVersion,
}: {
  options: RecipeIngredientOption[];
  initial: RecipeVersionInput;
  baseVersion: number;
}) {
  const router = useRouter();
  const form = useForm<RecipeVersionInput, unknown, RecipeVersionData>({
    resolver: zodResolver(recipeVersionInput),
    defaultValues: initial,
  });
  const lines = useFieldArray({ control: form.control, name: "items" });
  const [toAdd, setToAdd] = useState("");
  const save = useAction(createRecipeVersionAction, {
    success: (d) => `Versión ${d.version} guardada`,
    onSuccess: (d) => router.push(`/produccion/receta?v=${d.id}`),
  });
  const nameOf = (id: string) => options.find((o) => o.id === id)?.name ?? "Insumo";
  const unitOf = (id: string) => UNIT_SHORT[options.find((o) => o.id === id)?.unit ?? ""] ?? "";
  const used = new Set(lines.fields.map((f) => f.ingredientId));
  const available = options.filter((o) => !used.has(o.id));
  const errors = form.formState.errors;
  const serverErr = (k: string) => save.fieldErrors[k]?.[0];

  return (
    <form onSubmit={form.handleSubmit((data) => save.run(data))} className="grid max-w-5xl gap-6" noValidate>
      <FieldGroup className="grid gap-4 sm:grid-cols-3">
        <Field data-invalid={!!errors.expectedYieldPerKgStarch}>
          <FieldLabel htmlFor="expectedYield">
            Rendimiento esperado (kg de producto por kg de fécula)
          </FieldLabel>
          <Input id="expectedYield" inputMode="decimal" {...form.register("expectedYieldPerKgStarch")} />
          <FieldError>{errors.expectedYieldPerKgStarch?.message}</FieldError>
        </Field>
        <Field data-invalid={!!errors.deviationThresholdPct}>
          <FieldLabel htmlFor="threshold">Umbral de desvío del consumo (%)</FieldLabel>
          <Input id="threshold" inputMode="decimal" {...form.register("deviationThresholdPct")} />
          <FieldError>{errors.deviationThresholdPct?.message}</FieldError>
        </Field>
        <Field orientation="horizontal" className="items-end">
          <Controller
            control={form.control}
            name="activate"
            render={({ field }) => (
              <Switch id="activate" checked={!!field.value} onCheckedChange={field.onChange} />
            )}
          />
          <FieldLabel htmlFor="activate">Activar al guardar</FieldLabel>
        </Field>
        <Field className="sm:col-span-3" data-invalid={!!errors.notes}>
          <FieldLabel htmlFor="notes">Notas de la versión *</FieldLabel>
          <Textarea
            id="notes"
            rows={2}
            placeholder={`Qué cambia respecto de la versión ${baseVersion} y por qué`}
            {...form.register("notes")}
          />
          <FieldError>{errors.notes?.message ?? serverErr("notes")}</FieldError>
        </Field>
      </FieldGroup>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Insumo</TableHead>
              <TableHead className="w-32">Por kg de fécula</TableHead>
              <TableHead className="w-28">Mínimo</TableHead>
              <TableHead className="w-28">Máximo</TableHead>
              <TableHead>Instrucciones</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.fields.map((f, i) => {
              const name = nameOf(f.ingredientId);
              const err = errors.items?.[i];
              return (
                <TableRow key={f.id} className="align-top">
                  <TableCell className="font-medium">
                    {name} <span className="text-muted-foreground text-xs">({unitOf(f.ingredientId)})</span>
                    <FieldError>{err?.ingredientId?.message}</FieldError>
                  </TableCell>
                  <TableCell>
                    <Input
                      inputMode="decimal"
                      aria-label={`Cantidad de ${name} por kg de fécula`}
                      {...form.register(`items.${i}.qtyPerKgStarch`)}
                    />
                    <FieldError>{err?.qtyPerKgStarch?.message}</FieldError>
                  </TableCell>
                  <TableCell>
                    <Input
                      inputMode="decimal"
                      aria-label={`Mínimo de ${name}`}
                      {...form.register(`items.${i}.minPerKgStarch`)}
                    />
                    <FieldError>{err?.minPerKgStarch?.message}</FieldError>
                  </TableCell>
                  <TableCell>
                    <Input
                      inputMode="decimal"
                      aria-label={`Máximo de ${name}`}
                      {...form.register(`items.${i}.maxPerKgStarch`)}
                    />
                    <FieldError>{err?.maxPerKgStarch?.message}</FieldError>
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Instrucciones de ${name}`}
                      {...form.register(`items.${i}.instructions`)}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Quitar ${name}`}
                      onClick={() => lines.remove(i)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center gap-2 border-t p-3">
          <Select value={toAdd} onValueChange={setToAdd}>
            <SelectTrigger className="w-64" aria-label="Insumo a agregar">
              <SelectValue placeholder="Agregar insumo…" />
            </SelectTrigger>
            <SelectContent>
              {available.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            disabled={!toAdd}
            onClick={() => {
              lines.append({
                ingredientId: toAdd,
                qtyPerKgStarch: "",
                minPerKgStarch: "",
                maxPerKgStarch: "",
                instructions: "",
              });
              setToAdd("");
            }}
          >
            <Plus /> Agregar
          </Button>
          <FieldError>{errors.items?.root?.message ?? errors.items?.message}</FieldError>
        </div>
      </div>
      <FieldDescription>
        Las cantidades son por kg de fécula. El rango (mínimo y máximo) es lo aceptable al dosificar: si el
        consumo real queda fuera, la producción lo marca.
      </FieldDescription>

      <div className="flex gap-2">
        <Button type="submit" disabled={save.pending}>
          Guardar versión
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
