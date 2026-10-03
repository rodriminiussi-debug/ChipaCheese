"use client";

import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { addDays } from "@chipa/domain";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { UNIT } from "@/lib/labels";
import { toInput } from "../input";
import { purchaseOrderInput, type PurchaseOrderData, type PurchaseOrderFormInput } from "../schemas";
import { createOrderAction, updateOrderAction } from "../actions";

export interface OrderFormOptions {
  suppliers: { id: string; name: string; leadTimeDays: number; ingredientIds: string[] }[];
  ingredients: { id: string; name: string; unit: "kg" | "l" | "unit"; lastPrice: number | null }[];
  users: { id: string; name: string }[];
}

const NONE = "__none__";

/** Orden de compra (RF-10): proveedor, fechas, responsable e insumos con cantidad y precio estimado. */
export function OrderForm({
  options,
  initial,
  orderId,
  today,
}: {
  options: OrderFormOptions;
  initial?: PurchaseOrderFormInput;
  orderId?: string;
  today: string;
}) {
  const router = useRouter();
  const form = useForm<PurchaseOrderFormInput, unknown, PurchaseOrderData>({
    resolver: zodResolver(purchaseOrderInput),
    defaultValues: initial ?? {
      supplierId: "",
      orderedAt: today,
      expectedAt: "",
      responsibleId: null,
      notes: "",
      items: [{ ingredientId: "", qty: "", estimatedUnitPrice: "" }],
    },
  });
  const { fields, append, remove, replace } = useFieldArray({ control: form.control, name: "items" });
  const create = useAction(createOrderAction, {
    success: (r) => `Orden ${r.number} creada`,
    onSuccess: ({ id }) => router.push(`/compras/ordenes/${id}`),
  });
  const update = useAction(updateOrderAction, {
    success: "Orden guardada",
    onSuccess: () => router.refresh(),
  });
  const pending = create.pending || update.pending;
  const serverErrors = orderId ? update.fieldErrors : create.fieldErrors;
  const err = (path: string): string | undefined => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let node: any = form.formState.errors;
    for (const p of path.split(".")) node = node?.[p];
    return (node?.message as string | undefined) ?? serverErrors[path]?.[0];
  };

  const supplierId = useWatch({ control: form.control, name: "supplierId" });
  const supplier = options.suppliers.find((s) => s.id === supplierId);
  const watchedItems = useWatch({ control: form.control, name: "items" });

  const onSubmit = form.handleSubmit((d) => (orderId ? update.run({ ...d, id: orderId }) : create.run(d)));

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
                onValueChange={(v) => {
                  field.onChange(v === NONE ? "" : v);
                  const s = options.suppliers.find((x) => x.id === v);
                  // Fecha esperada = pedido + plazo de entrega del proveedor.
                  if (s) form.setValue("expectedAt", addDays(form.getValues("orderedAt"), s.leadTimeDays));
                }}
              >
                <SelectTrigger id="supplierId" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Elegí el proveedor…</SelectItem>
                  {options.suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldError>{err("supplierId")}</FieldError>
        </Field>
        <Field data-invalid={!!err("orderedAt")}>
          <FieldLabel htmlFor="orderedAt">Fecha del pedido</FieldLabel>
          <Input id="orderedAt" type="date" {...form.register("orderedAt")} />
          <FieldError>{err("orderedAt")}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="expectedAt">Entrega esperada</FieldLabel>
          <Input id="expectedAt" type="date" {...form.register("expectedAt")} />
          {supplier ? (
            <p className="text-muted-foreground text-xs">Plazo habitual: {supplier.leadTimeDays} días.</p>
          ) : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="responsibleId">Responsable</FieldLabel>
          <Controller
            control={form.control}
            name="responsibleId"
            render={({ field }) => (
              <Select
                value={field.value ?? NONE}
                onValueChange={(v) => field.onChange(v === NONE ? null : v)}
              >
                <SelectTrigger id="responsibleId" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Yo</SelectItem>
                  {options.users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="notes">Notas</FieldLabel>
          <Textarea id="notes" rows={1} {...form.register("notes")} />
        </Field>
      </FieldGroup>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Insumos</h2>
          <div className="flex gap-2">
            {supplier?.ingredientIds.length ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const kept = (form.getValues("items") ?? []).filter((r) => r.ingredientId);
                  const present = new Set(kept.map((r) => r.ingredientId));
                  const added = supplier.ingredientIds
                    .filter((ingredientId) => !present.has(ingredientId))
                    .map((ingredientId) => ({
                      ingredientId,
                      qty: "",
                      estimatedUnitPrice: toInput(
                        options.ingredients.find((i) => i.id === ingredientId)?.lastPrice,
                      ),
                    }));
                  replace([...kept, ...added]);
                }}
              >
                Cargar los insumos del proveedor
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ ingredientId: "", qty: "", estimatedUnitPrice: "" })}
            >
              <Plus /> Agregar insumo
            </Button>
          </div>
        </div>
        {err("items") ? <p className="text-destructive text-sm">{err("items")}</p> : null}
        {fields.map((f, i) => {
          const n = i + 1;
          const ing = options.ingredients.find((x) => x.id === watchedItems?.[i]?.ingredientId);
          return (
            <div key={f.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <Field data-invalid={!!err(`items.${i}.ingredientId`)}>
                <FieldLabel htmlFor={`oi-${i}`}>Insumo (línea {n})</FieldLabel>
                <Controller
                  control={form.control}
                  name={`items.${i}.ingredientId`}
                  render={({ field }) => (
                    <Select
                      value={field.value || NONE}
                      onValueChange={(v) => {
                        field.onChange(v === NONE ? "" : v);
                        const chosen = options.ingredients.find((x) => x.id === v);
                        // Precio estimado = último precio de compra.
                        if (chosen && !form.getValues(`items.${i}.estimatedUnitPrice`))
                          form.setValue(`items.${i}.estimatedUnitPrice`, toInput(chosen.lastPrice));
                      }}
                    >
                      <SelectTrigger id={`oi-${i}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Elegí el insumo…</SelectItem>
                        {options.ingredients.map((x) => (
                          <SelectItem key={x.id} value={x.id}>
                            {x.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError>{err(`items.${i}.ingredientId`)}</FieldError>
              </Field>
              <Field data-invalid={!!err(`items.${i}.qty`)}>
                <FieldLabel htmlFor={`oq-${i}`}>
                  Cantidad{ing ? ` (${UNIT[ing.unit]})` : ""} (línea {n})
                </FieldLabel>
                <Input id={`oq-${i}`} inputMode="decimal" {...form.register(`items.${i}.qty`)} />
                <FieldError>{err(`items.${i}.qty`)}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor={`op-${i}`}>Precio estimado (línea {n})</FieldLabel>
                <Input
                  id={`op-${i}`}
                  inputMode="decimal"
                  {...form.register(`items.${i}.estimatedUnitPrice`)}
                />
              </Field>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Quitar línea ${n}`}
                  onClick={() => remove(i)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          );
        })}
      </section>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {orderId ? "Guardar cambios" : "Crear orden"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
