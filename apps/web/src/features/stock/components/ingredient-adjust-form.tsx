"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { adjustIngredientStockAction } from "../actions";
import { ADJUSTMENT_KIND } from "../labels";
import {
  ADJUSTMENT_KINDS,
  ingredientAdjustmentInput,
  type IngredientAdjustmentData,
  type IngredientAdjustmentInput,
} from "../schemas";

export interface PositionOption {
  /** "<lotId|none>|<locationId>" */
  value: string;
  label: string;
}

/** RF-13: merma / descarte / corrección manual con motivo obligatorio. */
export function IngredientAdjustForm({
  ingredientId,
  unit,
  positions,
}: {
  ingredientId: string;
  unit: string;
  positions: PositionOption[];
}) {
  const router = useRouter();
  const first = positions[0]?.value.split("|");
  const form = useForm<IngredientAdjustmentInput, unknown, IngredientAdjustmentData>({
    resolver: zodResolver(ingredientAdjustmentInput),
    defaultValues: {
      ingredientId,
      rawLotId: first && first[0] !== "none" ? first[0] : null,
      locationId: first?.[1] ?? "",
      kind: "shrinkage",
      qty: "" as unknown as number,
      reason: "",
    },
  });
  const act = useAction(adjustIngredientStockAction, {
    success: "Ajuste registrado",
    onSuccess: () => {
      form.reset({ ...form.getValues(), qty: "" as unknown as number, reason: "" });
      router.refresh();
    },
  });
  const err = (name: keyof IngredientAdjustmentInput) =>
    form.formState.errors[name]?.message ?? act.fieldErrors[name]?.[0];
  const watchedLot = useWatch({ control: form.control, name: "rawLotId" });
  const watchedLocation = useWatch({ control: form.control, name: "locationId" });
  const positionValue = `${watchedLot ?? "none"}|${watchedLocation}`;

  return (
    <form
      onSubmit={form.handleSubmit((data) => act.run(data))}
      className="grid gap-4"
      noValidate
      aria-label="Ajuste manual de stock"
    >
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={!!err("locationId")}>
          <FieldLabel htmlFor="adj-position">Lote y ubicación</FieldLabel>
          <Select
            value={positionValue}
            onValueChange={(v) => {
              const [lot, loc] = v.split("|") as [string, string];
              form.setValue("rawLotId", lot === "none" ? null : lot);
              form.setValue("locationId", loc, { shouldValidate: true });
            }}
          >
            <SelectTrigger id="adj-position" className="w-full">
              <SelectValue placeholder="Elegí una posición" />
            </SelectTrigger>
            <SelectContent>
              {positions.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError>{err("locationId")}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="adj-kind">Tipo de ajuste</FieldLabel>
          <Controller
            control={form.control}
            name="kind"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="adj-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADJUSTMENT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {ADJUSTMENT_KIND[k].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field data-invalid={!!err("qty")}>
          <FieldLabel htmlFor="adj-qty">Cantidad ({unit})</FieldLabel>
          <Input
            id="adj-qty"
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            {...form.register("qty")}
          />
          <FieldError>{err("qty")}</FieldError>
        </Field>
        <Field data-invalid={!!err("reason")}>
          <FieldLabel htmlFor="adj-reason">Motivo *</FieldLabel>
          <Textarea
            id="adj-reason"
            rows={2}
            placeholder="Ej.: se cortó la cadena de frío, bolsa rota…"
            {...form.register("reason")}
          />
          <FieldError>{err("reason")}</FieldError>
        </Field>
      </FieldGroup>
      <div>
        <Button type="submit" disabled={act.pending || !positions.length}>
          Registrar ajuste
        </Button>
      </div>
    </form>
  );
}
