"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/app/native-select";
import { EmptyState } from "@/components/app/empty-state";
import { Money, Num } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { UNIT } from "@/lib/labels";
import { INGREDIENT_CATEGORY } from "@/features/purchases/labels";
import { toInput } from "@/features/purchases/input";
import { createIngredientAction, setIngredientActiveAction, updateIngredientAction } from "../actions";
import type { IngredientFormOptions, IngredientListRow } from "../ingredients";
import {
  INGREDIENT_CATEGORIES,
  INGREDIENT_UNITS,
  ingredientInput,
  type IngredientData,
  type IngredientFormInput,
} from "../schemas";
import { EditorDialog, SwitchField } from "./editor-dialog";

export function IngredientManager({
  rows,
  options,
}: {
  rows: IngredientListRow[];
  options: IngredientFormOptions;
}) {
  const [editing, setEditing] = useState<IngredientListRow | "new" | null>(null);
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus /> Nuevo insumo
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No hay insumos" description="Probá con otros filtros o cargá uno nuevo." />
      ) : (
        <div className="rounded-lg border">
          <Table aria-label="Insumos">
            <TableHeader>
              <TableRow>
                <TableHead>Insumo</TableHead>
                <TableHead className="hidden sm:table-cell">Categoría</TableHead>
                <TableHead className="text-right">Último precio (sin IVA)</TableHead>
                <TableHead className="hidden text-right md:table-cell">Mínimo / seguridad</TableHead>
                <TableHead className="hidden lg:table-cell">Proveedor habitual</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      onClick={() => setEditing(r)}
                      aria-label={`Editar ${r.name}`}
                    >
                      {r.name}
                    </button>
                    <div className="text-muted-foreground text-xs">
                      por {UNIT[r.unit]}
                      {r.refrigerated ? " · refrigerado" : ""}
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{INGREDIENT_CATEGORY[r.category]}</TableCell>
                  <TableCell className="text-right">
                    {r.lastPrice != null ? (
                      <Money value={r.lastPrice} />
                    ) : (
                      <StatusBadge tone="warn">Precio faltante</StatusBadge>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    <Num value={r.minStock} decimals={1} /> / <Num value={r.safetyStock} decimals={1} />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{r.supplierName ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge tone={r.active ? "good" : "neutral"}>
                      {r.active ? "Activo" : "Inactivo"}
                    </StatusBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing ? (
        <IngredientDialog
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? null : editing}
          options={options}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function IngredientDialog({
  row,
  options,
  onClose,
}: {
  row: IngredientListRow | null;
  options: IngredientFormOptions;
  onClose: () => void;
}) {
  const router = useRouter();
  const form = useForm<IngredientFormInput, unknown, IngredientData>({
    resolver: zodResolver(ingredientInput),
    defaultValues: row
      ? {
          name: row.name,
          category: row.category,
          unit: row.unit,
          refrigerated: row.refrigerated,
          minStock: toInput(row.minStock),
          safetyStock: toInput(row.safetyStock),
          defaultSupplierId: row.defaultSupplierId,
          active: row.active,
          initialPrice: "",
        }
      : {
          name: "",
          category: "other",
          unit: "kg",
          refrigerated: false,
          minStock: "0",
          safetyStock: "0",
          defaultSupplierId: null,
          active: true,
          initialPrice: "",
        },
  });
  const done = () => {
    onClose();
    router.refresh();
  };
  const create = useAction(createIngredientAction, { success: "Insumo creado", onSuccess: done });
  const update = useAction(updateIngredientAction, { success: "Cambios guardados", onSuccess: done });
  const toggle = useAction(setIngredientActiveAction, {
    success: (r) => (r.active ? "Insumo activado" : "Insumo desactivado"),
    onSuccess: done,
  });
  const pending = create.pending || update.pending || toggle.pending;
  const fe = row ? update.fieldErrors : create.fieldErrors;
  const err = (n: keyof IngredientFormInput) => form.formState.errors[n]?.message ?? fe[n]?.[0];
  const onSubmit = form.handleSubmit((d) => (row ? update.run({ ...d, id: row.id }) : create.run(d)));

  return (
    <EditorDialog
      title={row ? `Editar ${row.name}` : "Nuevo insumo"}
      description="Materias primas y envases que se compran y se usan en la receta o en los productos."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!err("name")} className="sm:col-span-2">
            <FieldLabel htmlFor="ing-name">Nombre *</FieldLabel>
            <Input id="ing-name" autoFocus {...form.register("name")} />
            <FieldError>{err("name")}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="ing-category">Categoría</FieldLabel>
            <NativeSelect id="ing-category" {...form.register("category")}>
              {INGREDIENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {INGREDIENT_CATEGORY[c]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field data-invalid={!!err("unit")}>
            <FieldLabel htmlFor="ing-unit">Unidad</FieldLabel>
            <NativeSelect id="ing-unit" {...form.register("unit")}>
              {INGREDIENT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT[u]}
                </option>
              ))}
            </NativeSelect>
            <FieldError>{err("unit")}</FieldError>
          </Field>
          <Field data-invalid={!!err("minStock")}>
            <FieldLabel htmlFor="ing-min">Stock mínimo</FieldLabel>
            <Input id="ing-min" inputMode="decimal" {...form.register("minStock")} />
            <FieldError>{err("minStock")}</FieldError>
          </Field>
          <Field data-invalid={!!err("safetyStock")}>
            <FieldLabel htmlFor="ing-safety">Stock de seguridad</FieldLabel>
            <Input id="ing-safety" inputMode="decimal" {...form.register("safetyStock")} />
            <FieldError>{err("safetyStock")}</FieldError>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="ing-supplier">Proveedor habitual</FieldLabel>
            <NativeSelect
              id="ing-supplier"
              {...form.register("defaultSupplierId", { setValueAs: (v) => v || null })}
            >
              <option value="">Sin proveedor habitual</option>
              {options.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {!row ? (
            <Field data-invalid={!!err("initialPrice")} className="sm:col-span-2">
              <FieldLabel htmlFor="ing-price">Precio inicial (sin IVA, por unidad)</FieldLabel>
              <Input id="ing-price" inputMode="decimal" {...form.register("initialPrice")} />
              <FieldError>{err("initialPrice")}</FieldError>
              <p className="text-muted-foreground text-xs">
                Opcional. Sin precio el costo de lo que lo usa queda como «precio faltante». Después se
                actualiza con cada factura.
              </p>
            </Field>
          ) : null}
          <div className="grid gap-3 sm:col-span-2">
            <SwitchField
              control={form.control}
              name="refrigerated"
              label="Refrigerado"
              hint="Se guarda en heladera."
            />
            <SwitchField control={form.control} name="active" label="Activo" />
          </div>
        </FieldGroup>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          {row ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => toggle.run({ id: row.id, active: !row.active })}
            >
              {row.active ? "Desactivar" : "Activar"}
            </Button>
          ) : null}
          <Button type="submit" disabled={pending}>
            {row ? "Guardar cambios" : "Crear insumo"}
          </Button>
        </div>
      </form>
    </EditorDialog>
  );
}
