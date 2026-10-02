"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAction } from "@/hooks/use-action";
import { CHANNEL } from "@/lib/labels";
import { WEEKDAY_LABELS } from "@/lib/dates";
import { customerInput, type CustomerData, type CustomerInput } from "../schemas";
import { createCustomerAction, updateCustomerAction } from "../actions";
import type { CustomerFormOptions } from "../service";

const NONE = "__none__";

/**
 * Patrón de formulario del proyecto: react-hook-form + el MISMO esquema zod que valida el servidor,
 * Server Action vía useAction (toast + errores de campo del servidor).
 */
export function CustomerForm({
  options,
  initial,
}: {
  options: CustomerFormOptions;
  initial?: CustomerInput & { id: string };
}) {
  const router = useRouter();
  const form = useForm<CustomerInput, unknown, CustomerData>({
    resolver: zodResolver(customerInput),
    defaultValues: initial ?? {
      legalName: "",
      channel: "reseller",
      deliveryWeekdays: [],
      paymentTermsDays: 0,
      active: true,
    },
  });
  const create = useAction(createCustomerAction, {
    success: "Cliente creado",
    onSuccess: ({ id }) => router.push(`/clientes/${id}`),
  });
  const update = useAction(updateCustomerAction, {
    success: "Cambios guardados",
    onSuccess: () => router.refresh(),
  });
  const pending = create.pending || update.pending;
  const serverErrors = initial ? update.fieldErrors : create.fieldErrors;
  const err = (name: keyof CustomerInput) => form.formState.errors[name]?.message ?? serverErrors[name]?.[0];

  const onSubmit = form.handleSubmit((data) =>
    initial ? update.run({ ...data, id: initial.id }) : create.run(data),
  );

  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-6" noValidate>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={!!err("legalName")}>
          <FieldLabel htmlFor="legalName">Razón social *</FieldLabel>
          <Input id="legalName" {...form.register("legalName")} />
          <FieldError>{err("legalName")}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="tradeName">Nombre de fantasía</FieldLabel>
          <Input id="tradeName" {...form.register("tradeName")} />
        </Field>
        <Field data-invalid={!!err("cuit")}>
          <FieldLabel htmlFor="cuit">CUIT</FieldLabel>
          <Input id="cuit" inputMode="numeric" placeholder="30-12345678-9" {...form.register("cuit")} />
          <FieldError>{err("cuit")}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="channel">Canal *</FieldLabel>
          <Controller
            control={form.control}
            name="channel"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="channel" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CHANNEL).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="priceListId">Lista de precios</FieldLabel>
          <Controller
            control={form.control}
            name="priceListId"
            render={({ field }) => (
              <Select
                value={field.value ?? NONE}
                onValueChange={(v) => field.onChange(v === NONE ? null : v)}
              >
                <SelectTrigger id="priceListId" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin lista</SelectItem>
                  {options.priceLists.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="zoneId">Zona de reparto</FieldLabel>
          <Controller
            control={form.control}
            name="zoneId"
            render={({ field }) => (
              <Select
                value={field.value ?? NONE}
                onValueChange={(v) => field.onChange(v === NONE ? null : v)}
              >
                <SelectTrigger id="zoneId" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin zona (retira)</SelectItem>
                  {options.zones.map((z) => (
                    <SelectItem key={z.id} value={z.id}>
                      {z.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel>Días de entrega (vacío = los de la zona)</FieldLabel>
          <Controller
            control={form.control}
            name="deliveryWeekdays"
            render={({ field }) => (
              <ToggleGroup
                type="multiple"
                variant="outline"
                value={(field.value ?? []).map(String)}
                onValueChange={(v) => field.onChange(v.map(Number).sort())}
              >
                {[1, 2, 3, 4, 5, 6].map((d) => (
                  <ToggleGroupItem key={d} value={String(d)} aria-label={WEEKDAY_LABELS[d]}>
                    {WEEKDAY_LABELS[d]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          />
        </Field>
        <Field data-invalid={!!err("paymentTermsDays")}>
          <FieldLabel htmlFor="paymentTermsDays">Plazo de pago (días)</FieldLabel>
          <Input
            id="paymentTermsDays"
            type="number"
            inputMode="numeric"
            min={0}
            {...form.register("paymentTermsDays")}
          />
          <FieldError>{err("paymentTermsDays")}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="paymentNotes">Condición de pago</FieldLabel>
          <Input id="paymentNotes" placeholder="Ej.: cheque a 30 días" {...form.register("paymentNotes")} />
        </Field>
        <Field>
          <FieldLabel htmlFor="whatsapp">WhatsApp</FieldLabel>
          <Input
            id="whatsapp"
            type="tel"
            inputMode="tel"
            placeholder="+54 9 341 ..."
            {...form.register("whatsapp")}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="address">Dirección</FieldLabel>
          <Input id="address" {...form.register("address")} />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="notes">Notas</FieldLabel>
          <Textarea id="notes" rows={3} {...form.register("notes")} />
        </Field>
        <Field orientation="horizontal">
          <Controller
            control={form.control}
            name="active"
            render={({ field }) => (
              <Switch id="active" checked={field.value ?? true} onCheckedChange={field.onChange} />
            )}
          />
          <FieldLabel htmlFor="active">Activo</FieldLabel>
        </Field>
      </FieldGroup>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {initial ? "Guardar cambios" : "Crear cliente"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
