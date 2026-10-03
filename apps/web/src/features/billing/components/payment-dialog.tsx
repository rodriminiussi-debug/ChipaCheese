"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HandCoins, Plus, Trash2 } from "lucide-react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatARS, parseDecimalAR } from "@chipa/domain";
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { registerPaymentAction } from "../actions";
import { paymentInput, type PaymentData, type PaymentInput } from "../schemas";

const METHODS = [
  { value: "cash", label: "Efectivo" },
  { value: "transfer", label: "Transferencia" },
  { value: "check", label: "Cheque" },
] as const;

const blankCheck = { bank: "", number: "", issuer: "", amount: "", cashDate: "", issueDate: "" };

/**
 * RF-31: registrar un cobro (efectivo, transferencia o uno o varios cheques). Se usa desde la ficha
 * del cliente (`variant="office"`) y desde la pantalla de ruta del chofer (`variant="route"`: botones grandes).
 */
export function PaymentDialog({
  customerId,
  customerName,
  today,
  routeId = null,
  variant = "office",
  label = "Registrar cobro",
  balance,
}: {
  customerId: string;
  customerName: string;
  today: string;
  routeId?: string | null;
  variant?: "office" | "route";
  label?: string;
  /** Saldo actual, solo informativo. */
  balance?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const big = variant === "route";
  const form = useForm<PaymentInput, unknown, PaymentData>({
    resolver: zodResolver(paymentInput),
    defaultValues: {
      customerId,
      date: today,
      method: "cash",
      amount: "",
      routeId,
      reference: "",
      notes: "",
      checks: [],
    },
  });
  const checks = useFieldArray({ control: form.control, name: "checks" });
  const method = useWatch({ control: form.control, name: "method" });
  const watchedChecks = useWatch({ control: form.control, name: "checks" });
  const act = useAction(registerPaymentAction, {
    success: (r) =>
      `Cobro registrado: ${formatARS(r.amount)}${r.settledOrders.length ? ` · pedido #${r.settledOrders.join(", #")} cobrado` : ""}`,
    onSuccess: () => {
      setOpen(false);
      form.reset();
      router.refresh();
    },
  });
  const err = (name: keyof PaymentInput) =>
    (form.formState.errors[name] as { message?: string } | undefined)?.message ?? act.fieldErrors[name]?.[0];
  const checkErr = (i: number, name: string) =>
    (form.formState.errors.checks?.[i] as Record<string, { message?: string }> | undefined)?.[name]?.message;

  const checksTotal = (watchedChecks ?? []).reduce((a, c) => {
    const v = typeof c?.amount === "number" ? c.amount : parseDecimalAR(String(c?.amount ?? ""));
    return a + (v ?? 0);
  }, 0);

  function chooseMethod(m: PaymentInput["method"]) {
    form.setValue("method", m, { shouldValidate: false });
    if (m === "check" && checks.fields.length === 0) checks.append({ ...blankCheck });
    if (m !== "check" && checks.fields.length > 0) checks.replace([]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) form.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size={big ? "lg" : "default"} className={cn(big && "h-12 text-base")}>
          <HandCoins /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar cobro</DialogTitle>
          <DialogDescription>
            {customerName}
            {balance != null ? ` · saldo ${formatARS(balance)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((d) => act.run(d))} className="grid gap-4" noValidate>
          <div role="radiogroup" aria-label="Medio de pago" className="grid grid-cols-3 gap-2">
            {METHODS.map((m) => (
              <Button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={method === m.value}
                variant={method === m.value ? "default" : "outline"}
                className={cn(big && "h-12 text-base")}
                onClick={() => chooseMethod(m.value)}
              >
                {m.label}
              </Button>
            ))}
          </div>

          <FieldGroup className="grid gap-4">
            {method !== "check" ? (
              <>
                <Field data-invalid={!!err("amount")}>
                  <FieldLabel htmlFor="pay-amount">Importe</FieldLabel>
                  <Input
                    id="pay-amount"
                    inputMode="decimal"
                    placeholder="0,00"
                    className={cn(big && "h-12 text-lg")}
                    {...form.register("amount")}
                  />
                  <FieldError>{err("amount")}</FieldError>
                </Field>
                {method === "transfer" ? (
                  <Field>
                    <FieldLabel htmlFor="pay-ref">Referencia (opcional)</FieldLabel>
                    <Input id="pay-ref" placeholder="N° de operación" {...form.register("reference")} />
                  </Field>
                ) : null}
              </>
            ) : (
              <div className="grid gap-3">
                {checks.fields.map((f, i) => (
                  <div
                    key={f.id}
                    role="group"
                    aria-label={`Cheque ${i + 1}`}
                    className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"
                  >
                    <Field data-invalid={!!checkErr(i, "bank")}>
                      <FieldLabel htmlFor={`chk-bank-${i}`}>Banco</FieldLabel>
                      <Input id={`chk-bank-${i}`} {...form.register(`checks.${i}.bank`)} />
                      <FieldError>{checkErr(i, "bank")}</FieldError>
                    </Field>
                    <Field data-invalid={!!checkErr(i, "number")}>
                      <FieldLabel htmlFor={`chk-number-${i}`}>N° de cheque</FieldLabel>
                      <Input
                        id={`chk-number-${i}`}
                        inputMode="numeric"
                        {...form.register(`checks.${i}.number`)}
                      />
                      <FieldError>{checkErr(i, "number")}</FieldError>
                    </Field>
                    <Field data-invalid={!!checkErr(i, "amount")}>
                      <FieldLabel htmlFor={`chk-amount-${i}`}>Importe del cheque</FieldLabel>
                      <Input
                        id={`chk-amount-${i}`}
                        inputMode="decimal"
                        placeholder="0,00"
                        {...form.register(`checks.${i}.amount`)}
                      />
                      <FieldError>{checkErr(i, "amount")}</FieldError>
                    </Field>
                    <Field data-invalid={!!checkErr(i, "cashDate")}>
                      <FieldLabel htmlFor={`chk-cash-${i}`}>Fecha de cobro</FieldLabel>
                      <Input id={`chk-cash-${i}`} type="date" {...form.register(`checks.${i}.cashDate`)} />
                      <FieldError>{checkErr(i, "cashDate")}</FieldError>
                    </Field>
                    <Field className="sm:col-span-2">
                      <FieldLabel htmlFor={`chk-issuer-${i}`}>Librador (opcional)</FieldLabel>
                      <Input
                        id={`chk-issuer-${i}`}
                        placeholder={customerName}
                        {...form.register(`checks.${i}.issuer`)}
                      />
                    </Field>
                    {checks.fields.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="justify-self-start"
                        onClick={() => checks.remove(i)}
                      >
                        <Trash2 /> Quitar cheque {i + 1}
                      </Button>
                    ) : null}
                  </div>
                ))}
                <FieldError>{err("checks")}</FieldError>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => checks.append({ ...blankCheck })}
                  >
                    <Plus /> Agregar otro cheque
                  </Button>
                  <span className="text-sm" data-testid="checks-total">
                    Total de cheques: <strong>{formatARS(checksTotal)}</strong>
                  </span>
                </div>
              </div>
            )}
            {!big ? (
              <Field data-invalid={!!err("date")}>
                <FieldLabel htmlFor="pay-date">Fecha del cobro</FieldLabel>
                <Input id="pay-date" type="date" max={today} {...form.register("date")} />
                <FieldError>{err("date")}</FieldError>
              </Field>
            ) : null}
          </FieldGroup>
          <DialogFooter className={cn(big && "gap-2")}>
            <Button
              type="button"
              variant="outline"
              className={cn(big && "h-12")}
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={act.pending} className={cn(big && "h-12 text-base")}>
              Guardar cobro
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
