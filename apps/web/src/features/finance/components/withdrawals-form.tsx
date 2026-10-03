"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { setWithdrawalsAction } from "../actions";
import { withdrawalsInput, type WithdrawalsData, type WithdrawalsInput } from "../schemas";

/** Edita lo que los socios retiran por mes (parámetro `finance.partner_withdrawals_monthly`). */
export function WithdrawalsForm({ amount }: { amount: number }) {
  const router = useRouter();
  const form = useForm<WithdrawalsInput, unknown, WithdrawalsData>({
    resolver: zodResolver(withdrawalsInput),
    defaultValues: { amount: String(amount).replace(".", ",") },
  });
  const save = useAction(setWithdrawalsAction, {
    success: "Retiros actualizados",
    onSuccess: () => router.refresh(),
  });
  const err = form.formState.errors.amount?.message ?? save.fieldErrors.amount?.[0];
  return (
    <form
      onSubmit={form.handleSubmit((d) => save.run(d))}
      className="flex flex-wrap items-end gap-2"
      noValidate
    >
      <Field className="w-52" data-invalid={!!err}>
        <FieldLabel htmlFor="withdrawals">Retiros mensuales de los socios ($)</FieldLabel>
        <Input id="withdrawals" inputMode="decimal" {...form.register("amount")} />
        <FieldError>{err}</FieldError>
      </Field>
      <Button type="submit" variant="outline" disabled={save.pending}>
        Guardar retiros
      </Button>
    </form>
  );
}
