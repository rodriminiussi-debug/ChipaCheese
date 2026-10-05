"use client";

import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { formatARS, marginPct } from "@chipa/domain";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/app/native-select";
import { useAction } from "@/hooks/use-action";
import { PRODUCT_KIND, SHAPE, UNIT } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { numberOf, toInput } from "@/features/purchases/input";
import { PRESENTATION } from "../labels";
import { previewProductCost } from "../preview";
import { PRODUCT_KINDS, productInput, type ProductData, type ProductFormInput } from "../schemas";
import { createProductAction, deleteProductAction, updateProductAction } from "../actions";
import type { ProductFormOptions } from "../products";

type Kind = (typeof PRODUCT_KINDS)[number];

/** Valores iniciales según el tipo: cada tipo arranca con lo que normalmente le corresponde. */
const KIND_DEFAULTS: Record<Kind, Partial<ProductFormInput>> = {
  manufactured: { shape: "tapita", presentation: "bag_500g", unitLabel: "bolsa", availableForOrders: true },
  resale: { shape: "other", presentation: "unit", unitLabel: "botella", availableForOrders: false },
  prepared: { shape: "other", presentation: "unit", unitLabel: "porción", availableForOrders: false },
};

export interface ProductFormInitial extends ProductFormInput {
  id: string;
}

export function ProductForm({
  options,
  initial,
  canDelete = false,
}: {
  options: ProductFormOptions;
  initial?: ProductFormInitial;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const editing = !!initial;
  const form = useForm<ProductFormInput, unknown, ProductData>({
    resolver: zodResolver(productInput),
    defaultValues: initial ?? {
      kind: "manufactured",
      code: "",
      name: "",
      ...KIND_DEFAULTS.manufactured,
      netWeightKg: "",
      barcode: "",
      defaultSupplierId: null,
      description: "",
      boardCode: "",
      minStockUnits: 0,
      baseProductId: null,
      baseQty: "",
      components: [],
      availableInStore: true,
      active: true,
      initialCost: "",
      initialPrices: options.priceLists.map((l) => ({ priceListId: l.id, unitPrice: "" })),
    },
  });
  const components = useFieldArray({ control: form.control, name: "components" });
  const prices = useFieldArray({ control: form.control, name: "initialPrices" });
  const kind = useWatch({ control: form.control, name: "kind" }) as Kind;
  const watched = useWatch({ control: form.control });

  const create = useAction(createProductAction, {
    success: "Producto creado",
    onSuccess: ({ id }) => router.push(`/catalogo/productos/${id}`),
  });
  const update = useAction(updateProductAction, {
    success: "Cambios guardados",
    onSuccess: () => router.refresh(),
  });
  const remove = useAction(deleteProductAction, {
    success: "Producto eliminado",
    onSuccess: () => router.push("/catalogo/productos"),
  });
  const pending = create.pending || update.pending || remove.pending;
  const serverErrors = editing ? update.fieldErrors : create.fieldErrors;
  const err = (path: string): string | undefined => {
    let node: unknown = form.formState.errors;
    for (const p of path.split(".")) node = (node as Record<string, unknown> | undefined)?.[p];
    return (
      ((node as { message?: string } | undefined)?.message as string | undefined) ?? serverErrors[path]?.[0]
    );
  };

  function pickKind(k: Kind) {
    form.setValue("kind", k, { shouldDirty: true });
    for (const [key, v] of Object.entries(KIND_DEFAULTS[k]))
      form.setValue(key as keyof ProductFormInput, v as never, { shouldDirty: true });
    // Cada tipo tiene sus propios campos: lo que no corresponde se limpia para no validar datos ocultos.
    if (k === "resale") components.replace([]);
    form.clearErrors();
  }

  const preview = previewProductCost(
    {
      kind,
      netWeightKg: numberOf(watched.netWeightKg) || null,
      baseProductId: watched.baseProductId ?? null,
      baseQty: numberOf(watched.baseQty) || null,
      initialCost:
        kind === "resale" && watched.initialCost !== "" && watched.initialCost != null
          ? numberOf(watched.initialCost)
          : null,
      components: (watched.components ?? []).map((c) => ({
        ingredientId: c?.ingredientId ?? "",
        qtyPerUnit: numberOf(c?.qtyPerUnit),
      })),
    },
    options.reference,
  );
  const base = options.baseProducts.find((b) => b.id === watched.baseProductId);
  const equivalentKg = numberOf(watched.baseQty) * (base?.netWeightKg ?? 0);

  const onSubmit = form.handleSubmit((data) =>
    editing ? update.run({ ...data, id: initial!.id }) : create.run(data),
  );

  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-8" noValidate>
      {/* Tipo */}
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Tipo de producto</h2>
        <div role="radiogroup" aria-label="Tipo de producto" className="grid gap-3 sm:grid-cols-3">
          {PRODUCT_KINDS.map((k) => {
            const selected = kind === k;
            return (
              <label
                key={k}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm",
                  selected ? "border-primary bg-primary/5 ring-primary/30 ring-2" : "hover:bg-muted/50",
                  editing && !selected && "cursor-not-allowed opacity-50",
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  <input
                    type="radio"
                    name="kind"
                    value={k}
                    checked={selected}
                    disabled={editing}
                    onChange={() => pickKind(k)}
                    className="accent-primary"
                  />
                  {PRODUCT_KIND[k]!.label}
                </span>
                <span className="text-muted-foreground">{PRODUCT_KIND[k]!.hint}</span>
              </label>
            );
          })}
        </div>
        {editing ? (
          <p className="text-muted-foreground text-xs">
            El tipo no se puede cambiar. Si te equivocaste, desactivá este producto y creá uno nuevo.
          </p>
        ) : null}
      </section>

      {/* Datos básicos */}
      <section className="grid gap-4">
        <h2 className="text-lg font-semibold">Datos</h2>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!err("code")}>
            <FieldLabel htmlFor="code">Código *</FieldLabel>
            <Input
              id="code"
              placeholder={
                kind === "manufactured" ? "CH-TAP-500" : kind === "resale" ? "RV-GAS-500" : "EL-HOR-250"
              }
              {...form.register("code")}
            />
            <FieldError>{err("code")}</FieldError>
          </Field>
          <Field data-invalid={!!err("name")}>
            <FieldLabel htmlFor="name">Nombre *</FieldLabel>
            <Input id="name" {...form.register("name")} />
            <FieldError>{err("name")}</FieldError>
          </Field>

          {kind === "manufactured" ? (
            <>
              <Field data-invalid={!!err("shape")}>
                <FieldLabel htmlFor="shape">Forma *</FieldLabel>
                <NativeSelect id="shape" {...form.register("shape")}>
                  {Object.entries(SHAPE)
                    .filter(([v]) => v !== "other")
                    .map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                </NativeSelect>
                <FieldError>{err("shape")}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor="presentation">Presentación</FieldLabel>
                <NativeSelect id="presentation" {...form.register("presentation")}>
                  {Object.entries(PRESENTATION).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field data-invalid={!!err("netWeightKg")}>
                <FieldLabel htmlFor="netWeightKg">Kg de masa por unidad *</FieldLabel>
                <Input
                  id="netWeightKg"
                  inputMode="decimal"
                  placeholder="0,5"
                  {...form.register("netWeightKg")}
                />
                <FieldError>{err("netWeightKg")}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor="boardCode">Código de pizarrón</FieldLabel>
                <Input id="boardCode" placeholder="C500" {...form.register("boardCode")} />
              </Field>
            </>
          ) : null}

          {kind === "resale" ? (
            <Field>
              <FieldLabel htmlFor="defaultSupplierId">Proveedor habitual</FieldLabel>
              <NativeSelect
                id="defaultSupplierId"
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
          ) : null}

          {kind === "prepared" ? (
            <>
              <Field data-invalid={!!err("baseProductId")} className="sm:col-span-2">
                <FieldLabel htmlFor="baseProductId">Producto base (chipá terminado) *</FieldLabel>
                <NativeSelect
                  id="baseProductId"
                  {...form.register("baseProductId", { setValueAs: (v) => v || null })}
                >
                  <option value="">Elegí el producto del que se elabora…</option>
                  {options.baseProducts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </NativeSelect>
                <FieldError>{err("baseProductId")}</FieldError>
              </Field>
              <Field data-invalid={!!err("baseQty")}>
                <FieldLabel htmlFor="baseQty">Unidades del producto base que consume *</FieldLabel>
                <Input id="baseQty" inputMode="decimal" placeholder="0,5" {...form.register("baseQty")} />
                <FieldError>{err("baseQty")}</FieldError>
                <p className="text-muted-foreground text-xs">Ej.: 0,5 = media bolsa por cada venta.</p>
              </Field>
              <Field data-invalid={!!err("netWeightKg")}>
                <FieldLabel htmlFor="netWeightKg">Equivalente en masa (kg)</FieldLabel>
                <Input
                  id="netWeightKg"
                  inputMode="decimal"
                  placeholder={
                    equivalentKg > 0 ? toInput(Math.round(equivalentKg * 1000) / 1000) : "Se calcula"
                  }
                  {...form.register("netWeightKg")}
                />
                <FieldError>{err("netWeightKg")}</FieldError>
                <p className="text-muted-foreground text-xs">Vacío = unidades del base × kg del base.</p>
              </Field>
            </>
          ) : null}

          <Field data-invalid={!!err("unitLabel")}>
            <FieldLabel htmlFor="unitLabel">Se cuenta en (bolsa, botella, lata…) *</FieldLabel>
            <Input id="unitLabel" {...form.register("unitLabel")} />
            <FieldError>{err("unitLabel")}</FieldError>
          </Field>
          <Field data-invalid={!!err("barcode")}>
            <FieldLabel htmlFor="barcode">Código de barras</FieldLabel>
            <Input id="barcode" inputMode="numeric" {...form.register("barcode")} />
            <FieldError>{err("barcode")}</FieldError>
          </Field>
          <Field data-invalid={!!err("minStockUnits")}>
            <FieldLabel htmlFor="minStockUnits">Stock mínimo (unidades)</FieldLabel>
            <Input
              id="minStockUnits"
              type="number"
              inputMode="numeric"
              min={0}
              {...form.register("minStockUnits")}
            />
            <FieldError>{err("minStockUnits")}</FieldError>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="description">Notas</FieldLabel>
            <Textarea id="description" rows={2} {...form.register("description")} />
          </Field>
        </FieldGroup>
      </section>

      {/* Componentes */}
      {kind !== "resale" ? (
        <section className="grid gap-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                {kind === "manufactured" ? "Componentes por unidad" : "Componentes extra (opcional)"}
              </h2>
              <p className="text-muted-foreground text-sm">
                {kind === "manufactured"
                  ? "Además de la masa: envase, etiqueta, rellenos (jamón, queso…). Se descuentan al envasar y suman al costo."
                  : "Algo más que se usa al elaborarlo (caja, bolsa para llevar…). Suma al costo."}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => components.append({ ingredientId: "", qtyPerUnit: "" })}
            >
              <Plus /> Agregar componente
            </Button>
          </div>
          {components.fields.map((f, i) => {
            const ing = options.ingredients.find((x) => x.id === watched.components?.[i]?.ingredientId);
            return (
              <div key={f.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_10rem_auto]">
                <Field data-invalid={!!err(`components.${i}.ingredientId`)}>
                  <FieldLabel htmlFor={`comp-${i}`}>Insumo (componente {i + 1})</FieldLabel>
                  <NativeSelect id={`comp-${i}`} {...form.register(`components.${i}.ingredientId`)}>
                    <option value="">Elegí el insumo…</option>
                    {options.ingredients.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <FieldError>{err(`components.${i}.ingredientId`)}</FieldError>
                </Field>
                <Field data-invalid={!!err(`components.${i}.qtyPerUnit`)}>
                  <FieldLabel htmlFor={`qty-${i}`}>
                    Cantidad por unidad{ing ? ` (${UNIT[ing.unit]})` : ""} ({i + 1})
                  </FieldLabel>
                  <Input
                    id={`qty-${i}`}
                    inputMode="decimal"
                    {...form.register(`components.${i}.qtyPerUnit`)}
                  />
                  <FieldError>{err(`components.${i}.qtyPerUnit`)}</FieldError>
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="self-end"
                  aria-label={`Quitar componente ${i + 1}`}
                  onClick={() => components.remove(i)}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </section>
      ) : null}

      {/* Costo y precios iniciales */}
      <section className="grid gap-4">
        <h2 className="text-lg font-semibold">{editing ? "Costo" : "Costo y precios iniciales"}</h2>
        {kind === "resale" && !editing ? (
          <Field data-invalid={!!err("initialCost")} className="max-w-xs">
            <FieldLabel htmlFor="initialCost">Costo de compra inicial (sin IVA, por unidad)</FieldLabel>
            <Input
              id="initialCost"
              inputMode="decimal"
              placeholder="1.100"
              {...form.register("initialCost")}
            />
            <FieldError>{err("initialCost")}</FieldError>
            <p className="text-muted-foreground text-xs">
              Opcional. Después se actualiza con cada factura de compra.
            </p>
          </Field>
        ) : null}
        <div role="status" className="bg-muted rounded-md p-3 text-sm" data-testid="cost-preview">
          {preview.cost != null ? (
            <>
              Costo directo estimado por unidad: <strong>{formatARS(preview.cost)}</strong>
              {kind === "resale" ? "" : " (a los precios de compra actuales)"}.
            </>
          ) : (
            <>Costo no disponible todavía: falta {preview.missing.join(", ")}. No se asume $0.</>
          )}
        </div>
        {!editing ? (
          <>
            <div>
              <h3 className="font-medium">Precio inicial por lista (opcional)</h3>
              <p className="text-muted-foreground text-sm">
                Vigente desde hoy. Lo podés cambiar después en Precios.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {prices.fields.map((f, i) => {
                const list = options.priceLists.find((l) => l.id === watched.initialPrices?.[i]?.priceListId);
                const raw = watched.initialPrices?.[i]?.unitPrice;
                const price = raw === "" || raw == null ? null : numberOf(raw);
                const margin =
                  price && price > 0 && preview.cost != null ? marginPct(price, preview.cost) : null;
                return (
                  <Field key={f.id} data-invalid={!!err(`initialPrices.${i}.unitPrice`)}>
                    <FieldLabel htmlFor={`price-${i}`}>Precio en {list?.name ?? "lista"}</FieldLabel>
                    <Input
                      id={`price-${i}`}
                      inputMode="decimal"
                      {...form.register(`initialPrices.${i}.unitPrice`)}
                    />
                    <FieldError>{err(`initialPrices.${i}.unitPrice`)}</FieldError>
                    {margin != null && list ? (
                      <p
                        className={cn(
                          "text-xs",
                          margin < list.targetMarginPct ? "text-destructive" : "text-muted-foreground",
                        )}
                        data-testid={`margin-${i}`}
                      >
                        Margen{" "}
                        {margin.toLocaleString("es-AR", {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}
                        % (objetivo {list.targetMarginPct}%)
                        {price != null && preview.cost != null && price < preview.cost
                          ? " — por debajo del costo"
                          : ""}
                      </p>
                    ) : null}
                  </Field>
                );
              })}
            </div>
          </>
        ) : null}
      </section>

      {/* Disponibilidad */}
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Disponibilidad</h2>
        <div className="grid gap-3">
          <SwitchRow
            form={form}
            name="availableInStore"
            label="Disponible en el local"
            hint="Aparece en la venta del local."
          />
          {kind === "manufactured" ? (
            <SwitchRow
              form={form}
              name="availableForOrders"
              label="Disponible en pedidos"
              hint="Se puede cargar en pedidos de clientes y entra en el plan de producción."
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              {kind === "resale"
                ? "La reventa no tiene lote: se vende en el local, no en pedidos."
                : "Los elaborados se venden en el local; al venderse descuentan el producto base."}
            </p>
          )}
          <SwitchRow
            form={form}
            name="active"
            label="Activo"
            hint="Si lo desactivás deja de ofrecerse, pero conserva su historial."
          />
        </div>
      </section>

      {Object.keys(serverErrors).length > 0 && !err("code") ? (
        <Alert variant="destructive">
          <AlertDescription>Revisá los campos marcados.</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {editing ? "Guardar cambios" : "Crear producto"}
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={() => router.push("/catalogo/productos")}>
          Cancelar
        </Button>
        {editing && canDelete ? (
          <Button
            type="button"
            size="lg"
            variant="ghost"
            className="text-destructive ml-auto"
            disabled={pending}
            onClick={() => {
              if (window.confirm("¿Borrar este producto? Solo se puede si no tiene movimientos."))
                remove.run({ id: initial!.id });
            }}
          >
            <Trash2 /> Borrar producto
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function SwitchRow({
  form,
  name,
  label,
  hint,
}: {
  form: ReturnType<typeof useForm<ProductFormInput, unknown, ProductData>>;
  name: "availableInStore" | "availableForOrders" | "active";
  label: string;
  hint: string;
}) {
  const id = `sw-${name}`;
  return (
    <Field orientation="horizontal">
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Switch id={id} checked={field.value ?? false} onCheckedChange={field.onChange} />
        )}
      />
      <div>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
    </Field>
  );
}
