"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { formatDateAR } from "@chipa/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { createComplaintAction, updateComplaintAction } from "../actions";
import { complaintInput, type ComplaintData, type ComplaintInput } from "../schemas";
import type { ComplaintFormOptions } from "../service";

const NONE = "__none__";

/**
 * Alta / edición de un reclamo o devolución con los campos de la planilla 2022: fecha, cliente, cantidad,
 * lote (con su vencimiento), motivo, acción sobre el cliente y sobre el producto, supervisor.
 * Se puede retener el lote al registrar el reclamo.
 */
export function ComplaintForm({
  options,
  today,
  initial,
}: {
  options: ComplaintFormOptions;
  today: string;
  initial?: ComplaintInput & { id: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<ComplaintInput, unknown, ComplaintData>({
    resolver: zodResolver(complaintInput),
    defaultValues: initial ?? { date: today, reason: "", holdLot: false },
  });
  const done = () => {
    setOpen(false);
    if (!initial) form.reset({ date: today, reason: "", holdLot: false });
    router.refresh();
  };
  const create = useAction(createComplaintAction, { success: "Reclamo registrado", onSuccess: done });
  const update = useAction(updateComplaintAction, { success: "Reclamo actualizado", onSuccess: done });
  const pending = create.pending || update.pending;
  const serverErrors = initial ? update.fieldErrors : create.fieldErrors;
  const err = (name: keyof ComplaintInput) => form.formState.errors[name]?.message ?? serverErrors[name]?.[0];
  const lotId = useWatch({ control: form.control, name: "finishedLotId" });
  const lot = options.lots.find((l) => l.id === lotId);

  const onSubmit = form.handleSubmit((data) =>
    initial ? update.run({ ...data, id: initial.id }) : create.run(data),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {initial ? (
          <Button variant="ghost" size="icon" aria-label="Editar reclamo">
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus /> Nuevo reclamo
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar reclamo" : "Nuevo reclamo o devolución"}</DialogTitle>
          <DialogDescription>Campos de la planilla de reclamos y devoluciones.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!err("date")}>
              <FieldLabel htmlFor="cp-date">Fecha *</FieldLabel>
              <Input id="cp-date" type="date" max={today} {...form.register("date")} />
              <FieldError>{err("date")}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="cp-customer">Cliente</FieldLabel>
              <Controller
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <Select
                    value={field.value ?? NONE}
                    onValueChange={(v) => field.onChange(v === NONE ? null : v)}
                  >
                    <SelectTrigger id="cp-customer" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Sin cliente</SelectItem>
                      {options.customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cp-lot">Lote</FieldLabel>
              <Controller
                control={form.control}
                name="finishedLotId"
                render={({ field }) => (
                  <Select
                    value={field.value ?? NONE}
                    onValueChange={(v) => field.onChange(v === NONE ? null : v)}
                  >
                    <SelectTrigger id="cp-lot" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Sin lote</SelectItem>
                      {options.lots.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.code}
                          {l.onHold ? " (retenido)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {lot ? (
                <p className="text-muted-foreground text-xs">Vence el {formatDateAR(lot.expiryDate)}</p>
              ) : null}
            </Field>
            <Field data-invalid={!!err("qtyUnits")}>
              <FieldLabel htmlFor="cp-qty">Cantidad (bolsas)</FieldLabel>
              <Input id="cp-qty" type="number" inputMode="numeric" min={1} {...form.register("qtyUnits")} />
              <FieldError>{err("qtyUnits")}</FieldError>
            </Field>
            <Field className="sm:col-span-2" data-invalid={!!err("reason")}>
              <FieldLabel htmlFor="cp-reason">Motivo *</FieldLabel>
              <Textarea
                id="cp-reason"
                rows={2}
                placeholder="Ej.: bolsas rotas"
                {...form.register("reason")}
              />
              <FieldError>{err("reason")}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="cp-caction">Acción sobre el cliente</FieldLabel>
              <Input
                id="cp-caction"
                placeholder="Ej.: reposición sin cargo"
                {...form.register("customerAction")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cp-paction">Acción sobre el producto</FieldLabel>
              <Input id="cp-paction" placeholder="Ej.: descarte" {...form.register("productAction")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="cp-supervisor">Supervisor</FieldLabel>
              <Controller
                control={form.control}
                name="supervisorId"
                render={({ field }) => (
                  <Select
                    value={field.value ?? NONE}
                    onValueChange={(v) => field.onChange(v === NONE ? null : v)}
                  >
                    <SelectTrigger id="cp-supervisor" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Yo (quien registra)</SelectItem>
                      {options.supervisors.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field orientation="horizontal" className="items-center self-end">
              <Controller
                control={form.control}
                name="holdLot"
                render={({ field }) => (
                  <Switch
                    id="cp-hold"
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                    disabled={!lotId}
                  />
                )}
              />
              <FieldLabel htmlFor="cp-hold">Retener el lote</FieldLabel>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {initial ? "Guardar cambios" : "Registrar reclamo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
