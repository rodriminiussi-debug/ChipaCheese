"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { PAYMENT_METHOD } from "@/lib/labels";
import { supplierPaymentInput, type SupplierPaymentData, type SupplierPaymentFormInput } from "../schemas";
import { registerPaymentAction } from "../actions";

/** Registrar un pago a proveedor (RF-12): fecha, importe, medio y referencia. */
export function PaymentDialog({
  supplierId,
  today,
  suggestedAmount,
}: {
  supplierId: string;
  today: string;
  suggestedAmount?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<SupplierPaymentFormInput, unknown, SupplierPaymentData>({
    resolver: zodResolver(supplierPaymentInput),
    defaultValues: {
      supplierId,
      date: today,
      amount: suggestedAmount && suggestedAmount > 0 ? String(suggestedAmount).replace(".", ",") : "",
      method: "transfer",
      reference: "",
      notes: "",
    },
  });
  const pay = useAction(registerPaymentAction, {
    success: "Pago registrado",
    onSuccess: () => {
      setOpen(false);
      form.reset({ ...form.getValues(), amount: "", reference: "", notes: "" });
      router.refresh();
    },
  });
  const err = (name: keyof SupplierPaymentFormInput) =>
    form.formState.errors[name]?.message ?? pay.fieldErrors[name]?.[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Wallet /> Registrar pago
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pago al proveedor</DialogTitle>
          <DialogDescription>Baja el saldo de la cuenta corriente.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((d) => pay.run(d))} noValidate className="grid gap-4">
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!err("date")}>
              <FieldLabel htmlFor="pay-date">Fecha</FieldLabel>
              <Input id="pay-date" type="date" {...form.register("date")} />
              <FieldError>{err("date")}</FieldError>
            </Field>
            <Field data-invalid={!!err("amount")}>
              <FieldLabel htmlFor="pay-amount">Importe</FieldLabel>
              <Input id="pay-amount" inputMode="decimal" placeholder="0,00" {...form.register("amount")} />
              <FieldError>{err("amount")}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="pay-method">Medio</FieldLabel>
              <Controller
                control={form.control}
                name="method"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="pay-method" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PAYMENT_METHOD).map(([v, l]) => (
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
              <FieldLabel htmlFor="pay-ref">Referencia</FieldLabel>
              <Input id="pay-ref" placeholder="N.º de operación, cheque…" {...form.register("reference")} />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="pay-notes">Notas</FieldLabel>
              <Input id="pay-notes" {...form.register("notes")} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pay.pending}>
              Guardar pago
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
