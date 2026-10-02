"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useAction } from "@/hooks/use-action";
import { updateIngredientLevelsAction } from "../actions";
import { ingredientLevelsInput, type IngredientLevelsData, type IngredientLevelsInput } from "../schemas";

/** RF-14: edición del stock mínimo y del stock de seguridad (entra en el punto de pedido). */
export function IngredientLevelsForm({
  ingredientId,
  unit,
  minStock,
  safetyStock,
}: {
  ingredientId: string;
  unit: string;
  minStock: number;
  safetyStock: number;
}) {
  const router = useRouter();
  const form = useForm<IngredientLevelsInput, unknown, IngredientLevelsData>({
    resolver: zodResolver(ingredientLevelsInput),
    defaultValues: { ingredientId, minStock, safetyStock },
  });
  const act = useAction(updateIngredientLevelsAction, {
    success: "Niveles guardados",
    onSuccess: () => router.refresh(),
  });
  const err = (name: keyof IngredientLevelsInput) =>
    form.formState.errors[name]?.message ?? act.fieldErrors[name]?.[0];

  return (
    <form
      onSubmit={form.handleSubmit((data) => act.run(data))}
      className="grid gap-4"
      noValidate
      aria-label="Stock mínimo y de seguridad"
    >
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={!!err("minStock")}>
          <FieldLabel htmlFor="minStock">Stock mínimo ({unit})</FieldLabel>
          <Input
            id="minStock"
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            {...form.register("minStock")}
          />
          <FieldDescription>Por debajo de este nivel el insumo pasa a “Reponer”.</FieldDescription>
          <FieldError>{err("minStock")}</FieldError>
        </Field>
        <Field data-invalid={!!err("safetyStock")}>
          <FieldLabel htmlFor="safetyStock">Stock de seguridad ({unit})</FieldLabel>
          <Input
            id="safetyStock"
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            {...form.register("safetyStock")}
          />
          <FieldDescription>
            Se suma al consumo del plazo de entrega para el punto de pedido.
          </FieldDescription>
          <FieldError>{err("safetyStock")}</FieldError>
        </Field>
      </FieldGroup>
      <div>
        <Button type="submit" disabled={act.pending}>
          Guardar niveles
        </Button>
      </div>
    </form>
  );
}
