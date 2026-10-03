"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatARS, parseDecimalAR, roundMoney } from "@chipa/domain";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { createInvoiceAction } from "../actions";
import { INVOICE_TYPE_LABEL } from "../labels";
import { invoiceInput, type InvoiceData, type InvoiceInput } from "../schemas";

const NONE = "__none__";

export interface DeliveredOrderOption {
  id: string;
  number: number;
  total: number;
  customerId: string;
}

const num = (v: unknown) => (typeof v === "number" ? v : (parseDecimalAR(String(v ?? "")) ?? 0));

/**
 * RF-30: alta manual de una factura emitida. El IVA es el que figura en la factura (Regla 11):
 * el total se completa con neto + IVA pero se puede corregir (otros tributos). Si se liga a un
 * pedido entregado, el pedido pasa a "facturado".
 */
export function InvoiceDialog({
  customers,
  customerId,
  orders,
  today,
}: {
  customers: { id: string; name: string }[];
  /** Cliente fijo (ficha del cliente); sin esto se elige en el formulario. */
  customerId?: string;
  orders: DeliveredOrderOption[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [totalTouched, setTotalTouched] = useState(false);
  const form = useForm<InvoiceInput, unknown, InvoiceData>({
    resolver: zodResolver(invoiceInput),
    defaultValues: {
      customerId: customerId ?? "",
      invoiceType: "A",
      pointOfSale: "",
      number: "",
      issueDate: today,
      dueDate: "",
      netTotal: "",
      vatTotal: "",
      total: "",
      cae: "",
      orderId: null,
    },
  });
  const act = useAction(createInvoiceAction, {
    success: (r) =>
      r.settledOrders.length
        ? `Factura cargada · pedido #${r.settledOrders.join(", #")} cobrado`
        : "Factura cargada",
    onSuccess: () => {
      setOpen(false);
      setTotalTouched(false);
      form.reset();
      router.refresh();
    },
  });
  const err = (name: keyof InvoiceInput) =>
    form.formState.errors[name]?.message ?? act.fieldErrors[name]?.[0];

  const selectedCustomer = useWatch({ control: form.control, name: "customerId" });
  const net = useWatch({ control: form.control, name: "netTotal" });
  const vat = useWatch({ control: form.control, name: "vatTotal" });
  const customerOrders = orders.filter((o) => o.customerId === selectedCustomer);

  useEffect(() => {
    if (totalTouched) return;
    const sum = roundMoney(num(net) + num(vat));
    form.setValue("total", sum > 0 ? String(sum).replace(".", ",") : "");
  }, [net, vat, form, totalTouched]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FilePlus2 /> Cargar factura
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Cargar factura emitida</DialogTitle>
          <DialogDescription>
            Los importes son los de la factura de ARCA. Vence a los días de plazo del cliente salvo que
            indiques otra fecha.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((d) => act.run(d))} className="grid gap-4" noValidate>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            {!customerId ? (
              <Field className="sm:col-span-2" data-invalid={!!err("customerId")}>
                <FieldLabel htmlFor="inv-customer">Cliente</FieldLabel>
                <Controller
                  control={form.control}
                  name="customerId"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        form.setValue("orderId", null);
                      }}
                    >
                      <SelectTrigger id="inv-customer" className="w-full">
                        <SelectValue placeholder="Elegí el cliente" />
                      </SelectTrigger>
                      <SelectContent>
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError>{err("customerId")}</FieldError>
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="inv-type">Tipo</FieldLabel>
              <Controller
                control={form.control}
                name="invoiceType"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="inv-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(INVOICE_TYPE_LABEL).map(([v, l]) => (
                        <SelectItem key={v} value={v}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field data-invalid={!!err("pointOfSale")}>
                <FieldLabel htmlFor="inv-pv">Punto de venta</FieldLabel>
                <Input id="inv-pv" inputMode="numeric" placeholder="0002" {...form.register("pointOfSale")} />
                <FieldError>{err("pointOfSale")}</FieldError>
              </Field>
              <Field data-invalid={!!err("number")}>
                <FieldLabel htmlFor="inv-number">Número</FieldLabel>
                <Input
                  id="inv-number"
                  inputMode="numeric"
                  placeholder="00001235"
                  {...form.register("number")}
                />
                <FieldError>{err("number")}</FieldError>
              </Field>
            </div>
            <Field data-invalid={!!err("issueDate")}>
              <FieldLabel htmlFor="inv-issue">Fecha de emisión</FieldLabel>
              <Input id="inv-issue" type="date" max={today} {...form.register("issueDate")} />
              <FieldError>{err("issueDate")}</FieldError>
            </Field>
            <Field data-invalid={!!err("dueDate")}>
              <FieldLabel htmlFor="inv-due">Vencimiento (opcional)</FieldLabel>
              <Input id="inv-due" type="date" {...form.register("dueDate")} />
              <FieldError>{err("dueDate")}</FieldError>
            </Field>
            <Field data-invalid={!!err("netTotal")}>
              <FieldLabel htmlFor="inv-net">Neto gravado</FieldLabel>
              <Input id="inv-net" inputMode="decimal" placeholder="0,00" {...form.register("netTotal")} />
              <FieldError>{err("netTotal")}</FieldError>
            </Field>
            <Field data-invalid={!!err("vatTotal")}>
              <FieldLabel htmlFor="inv-vat">IVA de la factura</FieldLabel>
              <Input id="inv-vat" inputMode="decimal" placeholder="0,00" {...form.register("vatTotal")} />
              <FieldError>{err("vatTotal")}</FieldError>
            </Field>
            <Field data-invalid={!!err("total")}>
              <FieldLabel htmlFor="inv-total">Total</FieldLabel>
              <Input
                id="inv-total"
                inputMode="decimal"
                placeholder="0,00"
                {...form.register("total", {
                  onChange: () => {
                    setTotalTouched(true);
                  },
                })}
              />
              <FieldError>{err("total")}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="inv-cae">CAE (opcional)</FieldLabel>
              <Input id="inv-cae" inputMode="numeric" {...form.register("cae")} />
            </Field>
            <Field className="sm:col-span-2" data-invalid={!!err("orderId")}>
              <FieldLabel htmlFor="inv-order">Pedido entregado (opcional)</FieldLabel>
              <Controller
                control={form.control}
                name="orderId"
                render={({ field }) => (
                  <Select
                    value={field.value ?? NONE}
                    onValueChange={(v) => {
                      field.onChange(v === NONE ? null : v);
                      const order = customerOrders.find((o) => o.id === v);
                      if (order && !form.getValues("total")) {
                        setTotalTouched(true);
                        form.setValue("total", String(order.total).replace(".", ","));
                      }
                    }}
                  >
                    <SelectTrigger id="inv-order" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Sin pedido</SelectItem>
                      {customerOrders.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          Pedido #{o.number} · {formatARS(o.total)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <p className="text-muted-foreground text-xs">El pedido pasa a «facturado».</p>
              <FieldError>{err("orderId")}</FieldError>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={act.pending}>
              Guardar factura
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
