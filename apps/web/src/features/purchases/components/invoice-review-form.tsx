"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, Plus, Trash2, UserPlus } from "lucide-react";
import {
  VAT_RATES,
  formatCuit,
  invoiceTotals,
  lineNet,
  lineVat,
  roundMoney,
  validateInvoiceTotals,
  type InvoiceLine,
} from "@chipa/domain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Money } from "@/components/app/format";
import { useAction } from "@/hooks/use-action";
import { UNIT } from "@/lib/labels";
import { INVOICE_TYPE } from "../labels";
import { numberOf, toInput } from "../input";
import { invoiceInput, type InvoiceFormData, type InvoiceFormInput } from "../schemas";
import {
  confirmInvoiceAction,
  createSupplierFromInvoiceAction,
  deleteInvoiceDraftAction,
  saveInvoiceAction,
} from "../actions";

const NONE = "__none__";
const FIELD_LABEL = { net: "Neto", vat: "IVA", total: "Total" } as const;

export interface ReviewSupplier {
  id: string;
  name: string;
  cuit: string | null;
}
export interface ReviewIngredient {
  id: string;
  name: string;
  unit: "kg" | "l" | "unit";
}

export interface ReviewProduct {
  id: string;
  name: string;
  unitLabel: string;
}

type Items = InvoiceFormInput["items"];

/** Totales de la factura calculados desde las líneas del formulario + comparación con los declarados. */
function computeCheck(v: {
  items?: Items;
  otherTaxes?: unknown;
  declaredNet?: unknown;
  declaredVat?: unknown;
  declaredTotal?: unknown;
}) {
  const lines: InvoiceLine[] = (v.items ?? []).map((i) => ({
    qty: numberOf(i.qty),
    unitPriceNet: numberOf(i.unitPriceNet),
    vatRate: numberOf(i.vatRate),
    vatAmount: i.vatAmount == null || i.vatAmount === "" ? null : numberOf(i.vatAmount),
  }));
  const otherTaxes = numberOf(v.otherTaxes);
  const totals = invoiceTotals(lines, otherTaxes);
  const blank = (x: unknown) => x == null || x === "";
  const validation = validateInvoiceTotals({
    lines,
    otherTaxes,
    declared: {
      net: blank(v.declaredNet) ? null : numberOf(v.declaredNet),
      vat: blank(v.declaredVat) ? null : numberOf(v.declaredVat),
      total: blank(v.declaredTotal) ? totals.total : numberOf(v.declaredTotal),
    },
  });
  return { lines, totals, ...validation };
}

function LineTotal({
  control,
  index,
}: {
  control: Control<InvoiceFormInput, unknown, InvoiceFormData>;
  index: number;
}) {
  const item = useWatch({ control, name: `items.${index}` });
  const line: InvoiceLine = {
    qty: numberOf(item?.qty),
    unitPriceNet: numberOf(item?.unitPriceNet),
    vatRate: numberOf(item?.vatRate),
    vatAmount: item?.vatAmount == null || item.vatAmount === "" ? null : numberOf(item.vatAmount),
  };
  return <Money value={roundMoney(lineNet(line) + lineVat(line))} className="font-medium" />;
}

/**
 * Revisión de la factura (RF-08): editás lo que leyó la IA mirando la foto, mapeás cada línea a un
 * insumo y confirmás. El IVA es siempre el de la factura (Regla 11); las diferencias de totales se
 * muestran en vivo con `validateInvoiceTotals`.
 */
export function InvoiceReviewForm({
  initial,
  suppliers,
  ingredients,
  products,
  extracted,
}: {
  initial: InvoiceFormInput;
  suppliers: ReviewSupplier[];
  ingredients: ReviewIngredient[];
  /** Productos de reventa a los que se puede mapear una línea (gaseosas, aguas…). */
  products: ReviewProduct[];
  /** Proveedor tal como lo leyó la IA (para ofrecer darlo de alta). */
  extracted: { supplierName: string | null; supplierCuit: string | null } | null;
}) {
  const router = useRouter();
  const form = useForm<InvoiceFormInput, unknown, InvoiceFormData>({
    resolver: zodResolver(invoiceInput),
    defaultValues: initial,
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const [acceptDifferences, setAcceptDifferences] = useState(false);
  const [receiveToStore, setReceiveToStore] = useState(false);

  const save = useAction(saveInvoiceAction, {
    success: "Borrador guardado",
    onSuccess: () => router.refresh(),
  });
  const confirm = useAction(confirmInvoiceAction, {
    success: (r) =>
      (r.pricesRecorded
        ? `Factura confirmada: ${r.pricesRecorded} precio${r.pricesRecorded === 1 ? "" : "s"} actualizado${r.pricesRecorded === 1 ? "" : "s"}`
        : "Factura confirmada") +
      (r.stockReceived
        ? ` · ${r.stockReceived} producto${r.stockReceived === 1 ? "" : "s"} ingresado${r.stockReceived === 1 ? "" : "s"} al local`
        : ""),
    onSuccess: () => router.refresh(),
  });
  const remove_ = useAction(deleteInvoiceDraftAction, {
    success: "Borrador eliminado",
    onSuccess: () => router.push("/compras/facturas"),
  });
  const createSupplier = useAction(createSupplierFromInvoiceAction, {
    success: (r) => `Proveedor "${r.name}" creado`,
    onSuccess: (r) => {
      form.setValue("supplierId", r.supplierId, { shouldDirty: true });
      router.refresh();
    },
  });

  const serverErrors = { ...save.fieldErrors, ...confirm.fieldErrors };
  const err = (path: string): string | undefined => {
    const parts = path.split(".");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let node: any = form.formState.errors;
    for (const p of parts) node = node?.[p];
    return (node?.message as string | undefined) ?? serverErrors[path]?.[0];
  };

  const watched = useWatch({ control: form.control });
  const check = useMemo(
    () =>
      computeCheck({
        items: watched.items as Items,
        otherTaxes: watched.otherTaxes,
        declaredNet: watched.declaredNet,
        declaredVat: watched.declaredVat,
        declaredTotal: watched.declaredTotal,
      }),
    [watched.items, watched.otherTaxes, watched.declaredNet, watched.declaredVat, watched.declaredTotal],
  );
  const diffByField = new Map(check.diffs.map((d) => [d.field, d]));
  const pending = save.pending || confirm.pending || remove_.pending;
  const supplierId = watched.supplierId;
  const supplierMissing = !supplierId;
  const unmapped = (watched.items ?? []).filter((i) => !i?.ingredientId && !i?.productId).length;
  const hasResale =
    (watched.items ?? []).some((i) => !!i?.productId) && !String(watched.invoiceType).startsWith("NC_");

  /** Al cambiar cantidad, precio o alícuota, el IVA de la línea se recalcula con la alícuota de la factura. */
  function recompute(
    index: number,
    override: Partial<{ qty: string; unitPriceNet: string; vatRate: string }> = {},
  ) {
    const it = form.getValues(`items.${index}`);
    const line: InvoiceLine = {
      qty: numberOf(override.qty ?? it.qty),
      unitPriceNet: numberOf(override.unitPriceNet ?? it.unitPriceNet),
      vatRate: numberOf(override.vatRate ?? it.vatRate),
    };
    form.setValue(`items.${index}.vatAmount`, toInput(lineVat(line)), { shouldDirty: true });
  }

  const submitSave = form.handleSubmit((d) => save.run(d));
  const submitConfirm = form.handleSubmit((d) => confirm.run({ ...d, acceptDifferences, receiveToStore }));

  return (
    <form onSubmit={submitConfirm} className="grid gap-6" noValidate>
      {/* Proveedor y comprobante */}
      <section className="grid gap-4">
        <h2 className="text-lg font-semibold">Comprobante</h2>
        <FieldGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field className="sm:col-span-2 lg:col-span-3" data-invalid={!!err("supplierId")}>
            <FieldLabel htmlFor="supplierId">Proveedor *</FieldLabel>
            <Controller
              control={form.control}
              name="supplierId"
              render={({ field }) => (
                <Select
                  value={field.value ?? NONE}
                  onValueChange={(v) => field.onChange(v === NONE ? null : v)}
                >
                  <SelectTrigger id="supplierId" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Elegí el proveedor…</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                        {s.cuit ? ` · ${formatCuit(s.cuit)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError>{err("supplierId")}</FieldError>
            {supplierMissing && extracted?.supplierName ? (
              <Alert className="mt-2">
                <UserPlus />
                <AlertTitle>No encontré el proveedor</AlertTitle>
                <AlertDescription>
                  <p>
                    La factura dice <strong>{extracted.supplierName}</strong>
                    {extracted.supplierCuit ? ` (CUIT ${formatCuit(extracted.supplierCuit)})` : ""}. Elegilo
                    arriba o dalo de alta con estos datos.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    disabled={createSupplier.pending}
                    onClick={() => createSupplier.run({ invoiceId: initial.id })}
                  >
                    Crear proveedor
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="invoiceType">Tipo</FieldLabel>
            <Controller
              control={form.control}
              name="invoiceType"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="invoiceType" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(INVOICE_TYPE).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field data-invalid={!!err("pointOfSale")}>
            <FieldLabel htmlFor="pointOfSale">Punto de venta</FieldLabel>
            <Input
              id="pointOfSale"
              inputMode="numeric"
              placeholder="0003"
              {...form.register("pointOfSale")}
            />
            <FieldError>{err("pointOfSale")}</FieldError>
          </Field>
          <Field data-invalid={!!err("number")}>
            <FieldLabel htmlFor="number">Número</FieldLabel>
            <Input id="number" inputMode="numeric" placeholder="00004567" {...form.register("number")} />
            <FieldError>{err("number")}</FieldError>
          </Field>
          <Field data-invalid={!!err("issueDate")}>
            <FieldLabel htmlFor="issueDate">Fecha de emisión</FieldLabel>
            <Input id="issueDate" type="date" {...form.register("issueDate")} />
            <FieldError>{err("issueDate")}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="dueDate">Vencimiento</FieldLabel>
            <Input id="dueDate" type="date" {...form.register("dueDate")} />
            <p className="text-muted-foreground text-xs">
              Si lo dejás vacío: emisión + plazo de pago del proveedor.
            </p>
          </Field>
        </FieldGroup>
      </section>

      {/* Líneas */}
      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Líneas</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              append({
                description: "",
                ingredientId: null,
                productId: null,
                qty: "",
                unit: null,
                unitPriceNet: "",
                vatRate: "21",
                vatAmount: "",
              })
            }
          >
            <Plus /> Agregar línea
          </Button>
        </div>
        {err("items") ? <p className="text-destructive text-sm">{err("items")}</p> : null}
        {fields.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            La factura no tiene líneas. Agregalas mirando la foto.
          </p>
        ) : null}
        {fields.map((f, i) => {
          const n = i + 1;
          const ingId = watched.items?.[i]?.ingredientId;
          const ing = ingredients.find((x) => x.id === ingId);
          const lineUnit = watched.items?.[i]?.unit;
          const unitMismatch = !!ing && !!lineUnit && lineUnit !== ing.unit;
          return (
            <div
              key={f.id}
              className="grid gap-3 rounded-lg border p-3 sm:grid-cols-6"
              data-testid={`line-${n}`}
            >
              <Field className="sm:col-span-3" data-invalid={!!err(`items.${i}.description`)}>
                <FieldLabel htmlFor={`desc-${i}`}>Descripción (línea {n})</FieldLabel>
                <Input id={`desc-${i}`} {...form.register(`items.${i}.description`)} />
                <FieldError>{err(`items.${i}.description`)}</FieldError>
              </Field>
              <Field className="sm:col-span-3" data-invalid={!!err(`items.${i}.productId`)}>
                <FieldLabel htmlFor={`ing-${i}`}>Insumo o producto (línea {n})</FieldLabel>
                <Select
                  value={
                    watched.items?.[i]?.productId
                      ? `p:${watched.items[i]!.productId}`
                      : ingId
                        ? `i:${ingId}`
                        : NONE
                  }
                  onValueChange={(v) => {
                    const ingredientId = v.startsWith("i:") ? v.slice(2) : null;
                    const productId = v.startsWith("p:") ? v.slice(2) : null;
                    form.setValue(`items.${i}.ingredientId`, ingredientId, { shouldDirty: true });
                    form.setValue(`items.${i}.productId`, productId, { shouldDirty: true });
                    const chosen = ingredients.find((x) => x.id === ingredientId);
                    if (chosen && !form.getValues(`items.${i}.unit`))
                      form.setValue(`items.${i}.unit`, chosen.unit, { shouldDirty: true });
                    if (productId && !form.getValues(`items.${i}.unit`))
                      form.setValue(`items.${i}.unit`, "unit", { shouldDirty: true });
                  }}
                >
                  <SelectTrigger id={`ing-${i}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No es un insumo (flete, otros)</SelectItem>
                    <SelectGroup>
                      <SelectLabel>Insumos</SelectLabel>
                      {ingredients.map((x) => (
                        <SelectItem key={x.id} value={`i:${x.id}`}>
                          {x.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    {products.length ? (
                      <SelectGroup>
                        <SelectLabel>Productos de reventa</SelectLabel>
                        {products.map((x) => (
                          <SelectItem key={x.id} value={`p:${x.id}`}>
                            {x.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                  </SelectContent>
                </Select>
                <FieldError>{err(`items.${i}.productId`)}</FieldError>
              </Field>
              <Field data-invalid={!!err(`items.${i}.qty`)}>
                <FieldLabel htmlFor={`qty-${i}`}>Cantidad (línea {n})</FieldLabel>
                <Input
                  id={`qty-${i}`}
                  inputMode="decimal"
                  {...form.register(`items.${i}.qty`, {
                    onChange: (e) => recompute(i, { qty: e.target.value }),
                  })}
                />
                <FieldError>{err(`items.${i}.qty`)}</FieldError>
              </Field>
              <Field data-invalid={unitMismatch || !!err(`items.${i}.unit`)}>
                <FieldLabel htmlFor={`unit-${i}`}>Unidad (línea {n})</FieldLabel>
                <Controller
                  control={form.control}
                  name={`items.${i}.unit`}
                  render={({ field }) => (
                    <Select
                      value={field.value ?? NONE}
                      onValueChange={(v) => field.onChange(v === NONE ? null : v)}
                    >
                      <SelectTrigger id={`unit-${i}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>—</SelectItem>
                        {Object.entries(UNIT).map(([v, l]) => (
                          <SelectItem key={v} value={v}>
                            {l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {unitMismatch ? (
                  <p className="text-destructive text-xs">El insumo se maneja en {UNIT[ing!.unit]}.</p>
                ) : (
                  <FieldError>{err(`items.${i}.unit`)}</FieldError>
                )}
              </Field>
              <Field className="sm:col-span-2" data-invalid={!!err(`items.${i}.unitPriceNet`)}>
                <FieldLabel htmlFor={`price-${i}`}>Precio neto unitario (línea {n})</FieldLabel>
                <Input
                  id={`price-${i}`}
                  inputMode="decimal"
                  {...form.register(`items.${i}.unitPriceNet`, {
                    onChange: (e) => recompute(i, { unitPriceNet: e.target.value }),
                  })}
                />
                <FieldError>{err(`items.${i}.unitPriceNet`)}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor={`rate-${i}`}>Alícuota (línea {n})</FieldLabel>
                <Controller
                  control={form.control}
                  name={`items.${i}.vatRate`}
                  render={({ field }) => {
                    const current = String(numberOf(field.value));
                    const rates = [...new Set([...VAT_RATES.map(String), current])];
                    return (
                      <Select
                        value={current}
                        onValueChange={(v) => {
                          field.onChange(v);
                          recompute(i, { vatRate: v });
                        }}
                      >
                        <SelectTrigger id={`rate-${i}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {rates.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r.replace(".", ",")} %
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    );
                  }}
                />
              </Field>
              <Field data-invalid={!!err(`items.${i}.vatAmount`)}>
                <FieldLabel htmlFor={`vat-${i}`}>IVA de la factura (línea {n})</FieldLabel>
                <Input id={`vat-${i}`} inputMode="decimal" {...form.register(`items.${i}.vatAmount`)} />
                <FieldError>{err(`items.${i}.vatAmount`)}</FieldError>
              </Field>
              <div className="flex items-end justify-between gap-2 sm:col-span-6">
                <div className="text-sm">
                  Total de la línea: <LineTotal control={form.control} index={i} />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(i)}
                  aria-label={`Quitar línea ${n}`}
                >
                  <Trash2 /> Quitar
                </Button>
              </div>
            </div>
          );
        })}
        {unmapped > 0 && fields.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            {unmapped} línea{unmapped === 1 ? "" : "s"} sin insumo ni producto: no actualiza
            {unmapped === 1 ? "" : "n"} el historial de precios.
          </p>
        ) : null}
      </section>

      {hasResale ? (
        <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
          <Checkbox checked={receiveToStore} onCheckedChange={(v) => setReceiveToStore(v === true)} />
          <span>
            <strong>Ingresar al local</strong> los productos de reventa de esta factura (suma stock en el
            local). El costo de compra se registra igual. Cargá cantidad y precio por unidad de venta
            (botella, lata…).
          </span>
        </label>
      ) : null}

      {/* Totales */}
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Totales</h2>
        <div className="grid gap-4 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_1fr]">
          <div className="text-muted-foreground hidden text-xs font-medium sm:block">Concepto</div>
          <div className="text-muted-foreground hidden text-xs font-medium sm:block">
            Calculado de las líneas
          </div>
          <div className="text-muted-foreground hidden text-xs font-medium sm:block">Según la factura</div>

          {(
            [
              ["net", "Neto", check.totals.net, "declaredNet"],
              ["vat", "IVA", check.totals.vat, "declaredVat"],
            ] as const
          ).map(([key, label, computed, name]) => (
            <TotalsRow key={key} label={label} computed={computed} diff={diffByField.get(key)}>
              <Input aria-label={`${label} según la factura`} inputMode="decimal" {...form.register(name)} />
            </TotalsRow>
          ))}
          <TotalsRow label="Percepciones y otros impuestos" computed={check.totals.otherTaxes}>
            <Input
              aria-label="Otros impuestos según la factura"
              inputMode="decimal"
              {...form.register("otherTaxes")}
            />
          </TotalsRow>
          <TotalsRow label="Total" computed={check.totals.total} diff={diffByField.get("total")} bold>
            <Input
              aria-label="Total según la factura"
              inputMode="decimal"
              aria-invalid={!!err("declaredTotal")}
              {...form.register("declaredTotal")}
            />
          </TotalsRow>
        </div>
        {!check.ok ? (
          <Alert variant="destructive" role="alert">
            <AlertTriangle />
            <AlertTitle>Los totales no coinciden</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {check.diffs.map((d) => (
                  <li key={d.field}>
                    {FIELD_LABEL[d.field]}: las líneas suman <Money value={d.computed} decimals={2} />, la
                    factura dice <Money value={d.declared} decimals={2} /> (diferencia{" "}
                    <Money value={roundMoney(d.declared - d.computed)} decimals={2} />
                    ).
                  </li>
                ))}
              </ul>
              <p className="mt-1">
                Revisá las líneas contra la foto o aceptá la diferencia para confirmar igual.
              </p>
              <label className="mt-2 flex items-center gap-2">
                <Checkbox
                  checked={acceptDifferences}
                  onCheckedChange={(v) => setAcceptDifferences(v === true)}
                />
                Aceptar la diferencia (vale el total de la factura)
              </label>
            </AlertDescription>
          </Alert>
        ) : (
          <p className="flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> Los totales coinciden con la factura.
          </p>
        )}
      </section>

      <Field>
        <FieldLabel htmlFor="notes">Notas</FieldLabel>
        <Textarea id="notes" rows={2} {...form.register("notes")} />
      </Field>

      <div className="bg-background sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t px-4 py-3 md:static md:mx-0 md:border-0 md:px-0">
        <Button type="submit" size="lg" disabled={pending}>
          Confirmar factura
        </Button>
        <Button type="button" size="lg" variant="outline" disabled={pending} onClick={submitSave}>
          Guardar borrador
        </Button>
        <Button
          type="button"
          size="lg"
          variant="ghost"
          className="text-destructive ml-auto"
          disabled={pending}
          onClick={() => {
            if (window.confirm("¿Eliminar este borrador?")) remove_.run({ id: initial.id });
          }}
        >
          <Trash2 /> Eliminar borrador
        </Button>
      </div>
    </form>
  );
}

function TotalsRow({
  label,
  computed,
  diff,
  bold,
  children,
}: {
  label: string;
  computed: number;
  diff?: { computed: number; declared: number };
  bold?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className={bold ? "font-semibold" : ""}>{label}</div>
      <div className={bold ? "font-semibold" : ""}>
        <Money value={computed} decimals={2} />
      </div>
      <div>
        {children}
        {diff ? (
          <div className="text-destructive mt-1 text-xs">
            Diferencia: <Money value={roundMoney(diff.declared - diff.computed)} decimals={2} />
          </div>
        ) : null}
      </div>
    </>
  );
}
