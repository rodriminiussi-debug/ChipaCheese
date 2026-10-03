"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarCheck, ChevronsUpDown, Minus, Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Money, Kg } from "@/components/app/format";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { orderKg, orderTotal, roundQty } from "@chipa/domain";
import {
  createOrderInput,
  updateOrderInput,
  type CreateOrderData,
  type CreateOrderInput,
  type UpdateOrderData,
  type UpdateOrderInput,
} from "../schemas";
import { createOrderAction, estimateOrderDateAction, updateOrderAction } from "../actions";
import { ORDER_SOURCE } from "../labels";
import type { OrderDateEstimate, OrderFormData } from "../service";
import { EstimateCard, weekdayDate } from "./estimate-card";

interface Initial {
  orderId: string;
  customerId: string;
  priceListId: string | null;
  promisedDate: string;
  notes: string | null;
  items: { productId: string; qtyUnits: number }[];
  /** Precio congelado de las líneas que ya existían. */
  frozenPrices: Record<string, number>;
}

type FormValues = CreateOrderInput & Partial<UpdateOrderInput>;

/**
 * RF-02: carga de pedido pensada para el celular. Cliente (combobox) → cantidades con botones grandes →
 * Guardar. La fecha ya viene con el próximo día de entrega del cliente y el origen en WhatsApp.
 * Con `initial` edita un pedido recibido/confirmado (RF-03).
 */
export function OrderForm({
  data,
  defaultCustomerId,
  initial,
}: {
  data: OrderFormData;
  defaultCustomerId?: string;
  initial?: Initial;
}) {
  const router = useRouter();
  const editing = !!initial;
  const preselected = initial?.customerId ?? defaultCustomerId ?? "";
  const preCustomer = data.customers.find((c) => c.id === preselected);

  const form = useForm<FormValues, unknown, CreateOrderData | UpdateOrderData>({
    resolver: zodResolver(editing ? updateOrderInput.omit({ id: true }) : createOrderInput) as never,
    defaultValues: {
      customerId: preselected,
      promisedDate: initial?.promisedDate ?? preCustomer?.defaultPromisedDate ?? "",
      source: "whatsapp",
      notes: initial?.notes ?? "",
      items: initial?.items ?? [],
    },
  });
  const customerId = useWatch({ control: form.control, name: "customerId" });
  const promisedDate = useWatch({ control: form.control, name: "promisedDate" });
  const items = (useWatch({ control: form.control, name: "items" }) ?? []) as {
    productId: string;
    qtyUnits: number;
  }[];
  const customer = data.customers.find((c) => c.id === customerId);
  const priceListId = initial?.priceListId ?? customer?.priceListId ?? null;

  const create = useAction(createOrderAction, {
    success: (o) => `Pedido #${o.number} cargado`,
    onSuccess: (o) => router.push(`/pedidos/${o.id}`),
  });
  const update = useAction(updateOrderAction, {
    success: "Pedido actualizado",
    onSuccess: (o) => router.push(`/pedidos/${o.id}`),
  });
  const pending = create.pending || update.pending;
  const serverErrors = editing ? update.fieldErrors : create.fieldErrors;

  // Productos con precio en la lista del cliente.
  const priced = useMemo(() => {
    const prices = (priceListId && data.prices[priceListId]) || {};
    return data.products
      .map((p) => ({ ...p, price: initial?.frozenPrices[p.id] ?? prices[p.id] }))
      .filter((p) => p.price != null) as ((typeof data.products)[number] & { price: number })[];
  }, [data, priceListId, initial]);

  const qtyOf = (productId: string) => items.find((i) => i.productId === productId)?.qtyUnits ?? 0;
  function setQty(productId: string, qty: number) {
    const q = Math.max(0, Math.min(100_000, Math.floor(Number.isFinite(qty) ? qty : 0)));
    const rest = items.filter((i) => i.productId !== productId);
    form.setValue("items", q > 0 ? [...rest, { productId, qtyUnits: q }] : rest, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    });
  }

  const lines = items.flatMap((i) => {
    const p = priced.find((x) => x.id === i.productId);
    return p
      ? [{ qtyUnits: i.qtyUnits, unitPrice: p.price, netWeightKg: p.netWeightKg, productId: p.id }]
      : [];
  });
  const total = orderTotal(lines);
  const kg = orderKg(lines);

  // RF-05: si el pedido supera el stock libre, pedimos la fecha posible (con debounce).
  const freeKg = roundQty(
    lines.reduce(
      (acc, l) => acc + Math.min(l.qtyUnits, data.freeStockUnits[l.productId] ?? 0) * l.netWeightKg,
      0,
    ),
  );
  const exceedsStock = kg > freeKg;
  const [estimated, setEstimated] = useState<{ key: string; value: OrderDateEstimate } | null>(null);
  const itemsKey = JSON.stringify(lines.map((l) => [l.productId, l.qtyUnits]));
  useEffect(() => {
    if (!exceedsStock) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await estimateOrderDateAction({
        items: lines.map((l) => ({ productId: l.productId, qtyUnits: l.qtyUnits })),
        excludeOrderId: initial?.orderId ?? null,
      });
      if (!cancelled && res.ok) setEstimated({ key: itemsKey, value: res.data });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, exceedsStock, initial?.orderId]);

  function pickCustomer(id: string) {
    const c = data.customers.find((x) => x.id === id);
    form.setValue("customerId", id, { shouldValidate: true });
    if (c) form.setValue("promisedDate", c.defaultPromisedDate);
    form.setValue("items", []);
  }

  const onSubmit = form.handleSubmit((values) =>
    editing
      ? update.run({
          id: initial!.orderId,
          promisedDate: values.promisedDate,
          notes: values.notes ?? null,
          items: values.items,
        })
      : create.run(values as CreateOrderData),
  );

  const err = (name: string) =>
    (form.formState.errors as Record<string, { message?: string }>)[name]?.message ?? serverErrors[name]?.[0];

  return (
    <form onSubmit={onSubmit} className="mx-auto grid max-w-2xl gap-5 pb-2" noValidate>
      {/* 1. Cliente */}
      <Field data-invalid={!!err("customerId")}>
        <FieldLabel>Cliente</FieldLabel>
        {editing ? (
          <p className="rounded-lg border px-3 py-2.5 font-medium">{customer?.name}</p>
        ) : (
          <CustomerCombobox customers={data.customers} value={customerId} onChange={pickCustomer} />
        )}
        <FieldError>{err("customerId")}</FieldError>
        {customer ? (
          <p className="text-muted-foreground text-xs">
            {customer.zone ? `Zona ${customer.zone} · ` : ""}
            {priceListId && priced.length ? `${priced.length} productos con precio` : "Sin lista de precios"}
          </p>
        ) : null}
      </Field>

      {/* 2. Productos */}
      <section aria-label="Productos" className="grid gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Productos</h2>
          {!editing && customer && customer.lastItems.length > 0 && items.length === 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const valid = customer.lastItems.filter((i) => priced.some((p) => p.id === i.productId));
                form.setValue("items", valid, { shouldDirty: true });
              }}
            >
              <Repeat /> Repetir el último pedido
            </Button>
          ) : null}
        </div>
        {!customer ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
            Elegí un cliente para ver los productos y sus precios.
          </p>
        ) : priced.length === 0 ? (
          <p className="text-destructive rounded-lg border border-dashed p-4 text-sm">
            Este cliente no tiene precios cargados. Asignale una lista de precios en su ficha.
          </p>
        ) : (
          <ul className="grid gap-2">
            {priced.map((p) => {
              const q = qtyOf(p.id);
              return (
                <li
                  key={p.id}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg border p-2 pl-3",
                    q > 0 && "border-primary bg-primary/5",
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm leading-tight font-medium">{p.name}</p>
                    <p className="text-muted-foreground text-xs">
                      <Money value={p.price} /> c/u
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      className="size-12"
                      aria-label={`Restar ${p.name}`}
                      disabled={q === 0}
                      onClick={() => setQty(p.id, q - 1)}
                    >
                      <Minus className="size-5" />
                    </Button>
                    <Input
                      aria-label={`Cantidad de ${p.name}`}
                      inputMode="numeric"
                      className="h-12 w-16 [appearance:textfield] text-center text-base font-semibold"
                      value={q === 0 ? "" : String(q)}
                      placeholder="0"
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setQty(p.id, Number(e.target.value.replace(/\D/g, "")))}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="size-12"
                      aria-label={`Sumar ${p.name}`}
                      onClick={() => setQty(p.id, q + 1)}
                    >
                      <Plus className="size-5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <FieldError>{err("items")}</FieldError>
      </section>

      {/* 3. Fecha, origen y notas */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={!!err("promisedDate")}>
          <FieldLabel htmlFor="promisedDate">Fecha comprometida</FieldLabel>
          <Input id="promisedDate" type="date" className="h-11" {...form.register("promisedDate")} />
          <FieldError>{err("promisedDate")}</FieldError>
          {promisedDate ? <p className="text-muted-foreground text-xs">{weekdayDate(promisedDate)}</p> : null}
        </Field>
        {!editing ? (
          <Field>
            <FieldLabel htmlFor="source">Origen</FieldLabel>
            <Controller
              control={form.control}
              name="source"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="source" className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ORDER_SOURCE).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        ) : null}
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="notes">Notas</FieldLabel>
          <Input id="notes" className="h-11" placeholder="Opcional" {...form.register("notes")} />
        </Field>
      </div>

      {estimated && estimated.key === itemsKey && exceedsStock ? (
        <EstimateCard
          estimate={estimated.value}
          promisedDate={promisedDate}
          useDateAction={
            <Button
              type="button"
              size="sm"
              onClick={() =>
                form.setValue("promisedDate", estimated.value.date!, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            >
              <CalendarCheck /> Usar esta fecha
            </Button>
          }
        />
      ) : null}

      {/* Barra inferior: total y guardar */}
      <div className="bg-background/95 sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t px-4 py-3 backdrop-blur md:mx-0 md:rounded-lg md:border">
        <div className="leading-tight" aria-live="polite">
          <p className="text-lg font-semibold" data-testid="order-total">
            <Money value={total} />
          </p>
          <p className="text-muted-foreground text-xs" data-testid="order-kg">
            <Kg value={kg} /> · {items.length} {items.length === 1 ? "producto" : "productos"}
          </p>
        </div>
        <Button type="submit" size="lg" className="h-12 px-6 text-base" disabled={pending}>
          {editing ? "Guardar cambios" : "Guardar pedido"}
        </Button>
      </div>
    </form>
  );
}

function CustomerCombobox({
  customers,
  value,
  onChange,
}: {
  customers: OrderFormData["customers"];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = customers.find((c) => c.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Cliente"
          className="h-12 w-full justify-between text-base font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected?.name ?? "Buscar cliente…"}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Escribí el nombre…" />
          <CommandList>
            <CommandEmpty>No hay clientes con ese nombre.</CommandEmpty>
            <CommandGroup>
              {customers.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.name} ${c.tradeName ?? ""}`}
                  className="py-3 text-base"
                  onSelect={() => {
                    onChange(c.id);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{c.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
