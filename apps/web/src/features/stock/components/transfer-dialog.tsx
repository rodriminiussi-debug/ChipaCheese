"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft } from "lucide-react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { transferProductAction } from "../actions";
import { productTransferInput, type ProductTransferData, type ProductTransferInput } from "../schemas";

const AUTO = "__fefo__";

export interface TransferLotOption {
  productId: string;
  locationId: string;
  finishedLotId: string;
  label: string;
}

/** RF-16: transferencia entre ubicaciones. Por defecto asigna FEFO (vence primero, sale primero). */
export function TransferDialog({
  products,
  locations,
  lots,
  defaultFromCode = "F3",
  defaultToCode = "LOCAL",
}: {
  products: { id: string; name: string; code: string }[];
  locations: { id: string; code: string; name: string }[];
  lots: TransferLotOption[];
  defaultFromCode?: string;
  defaultToCode?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<ProductTransferInput, unknown, ProductTransferData>({
    resolver: zodResolver(productTransferInput),
    defaultValues: {
      productId: "",
      fromLocationId: locations.find((l) => l.code === defaultFromCode)?.id ?? "",
      toLocationId: locations.find((l) => l.code === defaultToCode)?.id ?? "",
      units: "" as unknown as number,
      finishedLotId: null,
    },
  });
  const act = useAction(transferProductAction, {
    success: (r) =>
      `Transferencia registrada (${r.moved.map((m) => `${m.qty} u. del lote ${m.code ?? "s/l"}`).join(", ")})`,
    onSuccess: () => {
      setOpen(false);
      form.reset({ ...form.getValues(), units: "" as unknown as number, finishedLotId: null });
      router.refresh();
    },
  });
  const err = (name: keyof ProductTransferInput) =>
    form.formState.errors[name]?.message ?? act.fieldErrors[name]?.[0];
  const productId = useWatch({ control: form.control, name: "productId" });
  const fromId = useWatch({ control: form.control, name: "fromLocationId" });
  const lotOptions = lots.filter((l) => l.productId === productId && l.locationId === fromId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <ArrowRightLeft /> Transferir
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transferir producto terminado</DialogTitle>
          <DialogDescription>
            Mueve unidades entre ubicaciones conservando el lote. Sin elegir lote se toma el que vence
            primero.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((d) => act.run(d))} className="grid gap-4" noValidate>
          <FieldGroup className="grid gap-4">
            <Field data-invalid={!!err("productId")}>
              <FieldLabel htmlFor="tr-product">Producto</FieldLabel>
              <Controller
                control={form.control}
                name="productId"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      form.setValue("finishedLotId", null);
                    }}
                  >
                    <SelectTrigger id="tr-product" className="w-full">
                      <SelectValue placeholder="Elegí el producto" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError>{err("productId")}</FieldError>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field data-invalid={!!err("fromLocationId")}>
                <FieldLabel htmlFor="tr-from">Origen</FieldLabel>
                <Controller
                  control={form.control}
                  name="fromLocationId"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        form.setValue("finishedLotId", null);
                      }}
                    >
                      <SelectTrigger id="tr-from" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {locations.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError>{err("fromLocationId")}</FieldError>
              </Field>
              <Field data-invalid={!!err("toLocationId")}>
                <FieldLabel htmlFor="tr-to">Destino</FieldLabel>
                <Controller
                  control={form.control}
                  name="toLocationId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="tr-to" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {locations.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError>{err("toLocationId")}</FieldError>
              </Field>
            </div>
            <Field data-invalid={!!err("units")}>
              <FieldLabel htmlFor="tr-units">Unidades</FieldLabel>
              <Input
                id="tr-units"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                {...form.register("units")}
              />
              <FieldError>{err("units")}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="tr-lot">Lote</FieldLabel>
              <Controller
                control={form.control}
                name="finishedLotId"
                render={({ field }) => (
                  <Select
                    value={field.value ?? AUTO}
                    onValueChange={(v) => field.onChange(v === AUTO ? null : v)}
                  >
                    <SelectTrigger id="tr-lot" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO}>Automático (FEFO)</SelectItem>
                      {lotOptions.map((l) => (
                        <SelectItem key={l.finishedLotId} value={l.finishedLotId}>
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </FieldGroup>
          <Button type="submit" disabled={act.pending}>
            Confirmar transferencia
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
