"use client";

import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatARS, parseDecimalAR, roundMoney } from "@chipa/domain";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { closeCashAction } from "../actions";
import { cashClosingInput, type CashClosingData, type CashClosingInput } from "../schemas";

/** RF-33: cierre de caja del día (efectivo esperado, contado, diferencia y transferencias). */
export function CashClosingForm({
  expectedCash,
  expectedTransfer,
}: {
  expectedCash: number;
  expectedTransfer: number;
}) {
  const router = useRouter();
  const form = useForm<CashClosingInput, unknown, CashClosingData>({
    resolver: zodResolver(cashClosingInput),
    defaultValues: { countedCash: "", notes: "", date: "" },
  });
  const act = useAction(closeCashAction, {
    success: (r) =>
      r.difference === 0
        ? "Caja cerrada: sin diferencia"
        : `Caja cerrada: diferencia de ${formatARS(r.difference)}`,
    onSuccess: () => router.refresh(),
  });
  const err = (n: keyof CashClosingInput) => form.formState.errors[n]?.message ?? act.fieldErrors[n]?.[0];
  const raw = useWatch({ control: form.control, name: "countedCash" });
  const counted = typeof raw === "number" ? raw : parseDecimalAR(String(raw ?? ""));
  const difference = counted == null ? null : roundMoney(counted - expectedCash);

  return (
    <form onSubmit={form.handleSubmit((d) => act.run(d))} className="grid max-w-md gap-4" noValidate>
      <dl className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm">
        <dt className="text-muted-foreground">Efectivo esperado</dt>
        <dd className="text-right font-semibold tabular-nums" data-testid="expected-cash">
          {formatARS(expectedCash)}
        </dd>
        <dt className="text-muted-foreground">Transferencias del día</dt>
        <dd className="text-right tabular-nums" data-testid="expected-transfer">
          {formatARS(expectedTransfer)}
        </dd>
      </dl>
      <FieldGroup className="grid gap-4">
        <Field data-invalid={!!err("countedCash")}>
          <FieldLabel htmlFor="counted-cash">Efectivo contado</FieldLabel>
          <Input
            id="counted-cash"
            inputMode="decimal"
            placeholder="0,00"
            className="h-12 text-lg"
            {...form.register("countedCash")}
          />
          <FieldError>{err("countedCash")}</FieldError>
        </Field>
        <p role="status" className="text-sm" data-testid="cash-difference">
          {difference == null ? (
            "Contá el efectivo de la caja para ver la diferencia."
          ) : difference === 0 ? (
            "Caja justa: sin diferencia."
          ) : (
            <>
              Diferencia:{" "}
              <strong className={difference < 0 ? "text-destructive" : "text-emerald-600"}>
                {formatARS(difference)}
              </strong>{" "}
              {difference < 0 ? "(falta plata)" : "(sobra plata)"}
            </>
          )}
        </p>
        <Field>
          <FieldLabel htmlFor="closing-notes">Observaciones (opcional)</FieldLabel>
          <Textarea id="closing-notes" rows={2} {...form.register("notes")} />
        </Field>
      </FieldGroup>
      <Button type="submit" size="lg" className="h-12 text-base" disabled={act.pending}>
        Cerrar caja
      </Button>
    </form>
  );
}
