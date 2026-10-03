"use client";

import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Plus, Snowflake, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { MAX_REFRIGERATED_TEMP_C, isTemperatureAlert } from "@chipa/domain";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { UNIT } from "@/lib/labels";
import { numberOf, toInput } from "../input";
import { receptionInput, type ReceptionData, type ReceptionFormInput } from "../schemas";
import { createReceptionAction } from "../actions";
import type { ReceptionFormData } from "../receptions";

const NONE = "__none__";

/**
 * Recepción de mercadería (RF-11): cantidad real, lote del proveedor, vencimiento, temperatura
 * (obligatoria en refrigerados, alerta si supera los 5 °C) y ubicación. Desde una OC o libre.
 */
export function ReceptionForm({ data }: { data: ReceptionFormData }) {
  const router = useRouter();
  const { order } = data;
  const byId = new Map(data.ingredients.map((i) => [i.id, i]));
  const defaultLocation = (ingredientId: string) =>
    byId.get(ingredientId)?.refrigerated ? data.fridgeId : data.dryId;
  const blankLine = {
    ingredientId: "",
    qty: "",
    supplierLotCode: "",
    expiryDate: "",
    temperatureC: "",
    locationId: data.dryId,
  };

  const form = useForm<ReceptionFormInput, unknown, ReceptionData>({
    resolver: zodResolver(receptionInput),
    defaultValues: {
      supplierId: order?.supplierId ?? "",
      purchaseOrderId: order?.id ?? null,
      deliveryNote: "",
      notes: "",
      lines: order?.lines.length
        ? order.lines.map((l) => ({
            ingredientId: l.ingredientId,
            qty: toInput(l.pending),
            supplierLotCode: "",
            expiryDate: "",
            temperatureC: "",
            locationId: defaultLocation(l.ingredientId),
          }))
        : [blankLine],
    },
  });
  const { fields, append, remove, replace } = useFieldArray({ control: form.control, name: "lines" });
  const supplierId = useWatch({ control: form.control, name: "supplierId" });
  const lines = useWatch({ control: form.control, name: "lines" });

  const create = useAction(createReceptionAction, {
    onSuccess: (r) => {
      toast.success(
        `Recepción registrada: ${r.lots} lote${r.lots === 1 ? "" : "s"} ingresado${r.lots === 1 ? "" : "s"} al stock`,
      );
      for (const a of r.alerts)
        toast.warning(
          `${a.ingredient}: llegó a ${String(a.temperatureC).replace(".", ",")} °C (máx. ${MAX_REFRIGERATED_TEMP_C} °C)`,
          {
            duration: 12000,
          },
        );
      router.push(order ? `/compras/ordenes/${order.id}` : "/compras/recepciones");
    },
  });
  const err = (path: string): string | undefined => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let node: any = form.formState.errors;
    for (const p of path.split(".")) node = node?.[p];
    return (node?.message as string | undefined) ?? create.fieldErrors[path]?.[0];
  };

  const supplierIngredients = data.ingredients.filter((i) => i.supplierIds.includes(supplierId));
  const onSubmit = form.handleSubmit((d) => create.run(d));

  return (
    <form onSubmit={onSubmit} className="grid max-w-4xl gap-6" noValidate>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field className="sm:col-span-2" data-invalid={!!err("supplierId")}>
          <FieldLabel htmlFor="supplierId">Proveedor *</FieldLabel>
          <Controller
            control={form.control}
            name="supplierId"
            render={({ field }) => (
              <Select
                value={field.value || NONE}
                onValueChange={(v) => field.onChange(v === NONE ? "" : v)}
                disabled={!!order}
              >
                <SelectTrigger id="supplierId" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Elegí el proveedor…</SelectItem>
                  {data.suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldError>{err("supplierId")}</FieldError>
          {order ? (
            <p className="text-muted-foreground text-xs">Recibiendo la orden {order.number}.</p>
          ) : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="deliveryNote">Remito del proveedor</FieldLabel>
          <Input id="deliveryNote" {...form.register("deliveryNote")} />
        </Field>
        <Field>
          <FieldLabel htmlFor="notes">Notas</FieldLabel>
          <Textarea id="notes" rows={1} {...form.register("notes")} />
        </Field>
      </FieldGroup>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Mercadería recibida</h2>
          <div className="flex gap-2">
            {!order && supplierIngredients.length ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const kept = (form.getValues("lines") ?? []).filter((l) => l.ingredientId);
                  const present = new Set(kept.map((l) => l.ingredientId));
                  replace([
                    ...kept,
                    ...supplierIngredients
                      .filter((i) => !present.has(i.id))
                      .map((i) => ({ ...blankLine, ingredientId: i.id, locationId: defaultLocation(i.id) })),
                  ]);
                }}
              >
                Cargar los insumos del proveedor
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => append(blankLine)}>
              <Plus /> Agregar insumo
            </Button>
          </div>
        </div>
        {err("lines") ? <p className="text-destructive text-sm">{err("lines")}</p> : null}
        <p className="text-muted-foreground text-sm">Dejá la cantidad en 0 de lo que no llegó.</p>

        {fields.map((f, i) => {
          const n = i + 1;
          const ing = byId.get(lines?.[i]?.ingredientId ?? "");
          const temp = lines?.[i]?.temperatureC;
          const tempValue = temp === "" || temp == null ? null : numberOf(temp);
          const hot = ing?.refrigerated && tempValue != null && isTemperatureAlert(tempValue);
          const pending = order?.lines.find((l) => l.ingredientId === ing?.id)?.pending;
          return (
            <div key={f.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-6">
              <Field className="sm:col-span-3" data-invalid={!!err(`lines.${i}.ingredientId`)}>
                <FieldLabel htmlFor={`ri-${i}`}>
                  Insumo (línea {n}){" "}
                  {ing?.refrigerated ? (
                    <Snowflake className="inline size-3.5 text-sky-600" aria-label="Refrigerado" />
                  ) : null}
                </FieldLabel>
                <Controller
                  control={form.control}
                  name={`lines.${i}.ingredientId`}
                  render={({ field }) => (
                    <Select
                      value={field.value || NONE}
                      onValueChange={(v) => {
                        field.onChange(v === NONE ? "" : v);
                        if (v !== NONE) form.setValue(`lines.${i}.locationId`, defaultLocation(v));
                      }}
                    >
                      <SelectTrigger id={`ri-${i}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Elegí el insumo…</SelectItem>
                        {data.ingredients.map((x) => (
                          <SelectItem key={x.id} value={x.id}>
                            {x.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError>{err(`lines.${i}.ingredientId`)}</FieldError>
              </Field>
              <Field className="sm:col-span-1" data-invalid={!!err(`lines.${i}.qty`)}>
                <FieldLabel htmlFor={`rq-${i}`}>
                  Cantidad{ing ? ` (${UNIT[ing.unit]})` : ""} (línea {n})
                </FieldLabel>
                <Input id={`rq-${i}`} inputMode="decimal" {...form.register(`lines.${i}.qty`)} />
                <FieldError>{err(`lines.${i}.qty`)}</FieldError>
                {pending != null ? (
                  <p className="text-muted-foreground text-xs">
                    Pendiente: {String(pending).replace(".", ",")}
                  </p>
                ) : null}
              </Field>
              <Field className="sm:col-span-2" data-invalid={!!err(`lines.${i}.supplierLotCode`)}>
                <FieldLabel htmlFor={`rl-${i}`}>Lote del proveedor (línea {n})</FieldLabel>
                <Input id={`rl-${i}`} {...form.register(`lines.${i}.supplierLotCode`)} />
                <FieldError>{err(`lines.${i}.supplierLotCode`)}</FieldError>
              </Field>
              <Field className="sm:col-span-2" data-invalid={!!err(`lines.${i}.expiryDate`)}>
                <FieldLabel htmlFor={`re-${i}`}>Vencimiento (línea {n})</FieldLabel>
                <Input id={`re-${i}`} type="date" {...form.register(`lines.${i}.expiryDate`)} />
                <FieldError>{err(`lines.${i}.expiryDate`)}</FieldError>
              </Field>
              <Field className="sm:col-span-2" data-invalid={!!err(`lines.${i}.temperatureC`) || !!hot}>
                <FieldLabel htmlFor={`rt-${i}`}>
                  Temperatura °C{ing?.refrigerated ? " *" : ""} (línea {n})
                </FieldLabel>
                <Input
                  id={`rt-${i}`}
                  inputMode="decimal"
                  placeholder={ing?.refrigerated ? "Ej.: 4" : "—"}
                  {...form.register(`lines.${i}.temperatureC`)}
                />
                <FieldError>{err(`lines.${i}.temperatureC`)}</FieldError>
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor={`rloc-${i}`}>Ubicación (línea {n})</FieldLabel>
                <Controller
                  control={form.control}
                  name={`lines.${i}.locationId`}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id={`rloc-${i}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {data.locations.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <div className="flex items-end justify-end sm:col-span-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(i)}
                  aria-label={`Quitar línea ${n}`}
                >
                  <Trash2 /> Quitar
                </Button>
              </div>
              {hot ? (
                <p role="alert" className="text-destructive flex items-center gap-1 text-sm sm:col-span-6">
                  <AlertTriangle className="size-4" /> Temperatura fuera de rango: supera los{" "}
                  {MAX_REFRIGERATED_TEMP_C} °C. Se registra igual y queda la alerta.
                </p>
              ) : null}
            </div>
          );
        })}
      </section>

      <div className="flex gap-2">
        <Button type="submit" size="lg" disabled={create.pending}>
          Registrar recepción
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
