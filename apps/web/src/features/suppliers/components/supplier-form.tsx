"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useAction } from "@/hooks/use-action";
import { supplierInput, type SupplierData, type SupplierInput } from "../schemas";
import { createSupplierAction, updateSupplierAction } from "../actions";

/** Ficha de proveedor (RF-07): mismo patrón que el formulario de clientes. */
export function SupplierForm({ initial }: { initial?: SupplierInput & { id: string } }) {
  const router = useRouter();
  const form = useForm<SupplierInput, unknown, SupplierData>({
    resolver: zodResolver(supplierInput),
    defaultValues: initial ?? { legalName: "", leadTimeDays: 1, paymentTermsDays: 0, active: true },
  });
  const create = useAction(createSupplierAction, {
    success: "Proveedor creado",
    onSuccess: ({ id }) => router.push(`/proveedores/${id}`),
  });
  const update = useAction(updateSupplierAction, {
    success: "Cambios guardados",
    onSuccess: () => router.refresh(),
  });
  const pending = create.pending || update.pending;
  const serverErrors = initial ? update.fieldErrors : create.fieldErrors;
  const err = (name: keyof SupplierInput) => form.formState.errors[name]?.message ?? serverErrors[name]?.[0];

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
          <FieldLabel htmlFor="whatsapp">WhatsApp</FieldLabel>
          <Input
            id="whatsapp"
            type="tel"
            inputMode="tel"
            placeholder="+54 9 341 ..."
            {...form.register("whatsapp")}
          />
        </Field>
        <Field data-invalid={!!err("leadTimeDays")}>
          <FieldLabel htmlFor="leadTimeDays">Plazo de entrega (días)</FieldLabel>
          <Input
            id="leadTimeDays"
            type="number"
            inputMode="numeric"
            min={0}
            {...form.register("leadTimeDays")}
          />
          <FieldError>{err("leadTimeDays")}</FieldError>
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
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="paymentNotes">Condición de pago</FieldLabel>
          <Input
            id="paymentNotes"
            placeholder="Ej.: transferencia a 15 días"
            {...form.register("paymentNotes")}
          />
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
          {initial ? "Guardar cambios" : "Crear proveedor"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
