"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Copy, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/app/native-select";
import { Num } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { useAction } from "@/hooks/use-action";
import { CHANNEL } from "@/lib/labels";
import { toInput } from "@/features/purchases/input";
import { copyPricesAction, createPriceListAction, updatePriceListAction } from "../actions";
import type { PriceListRow } from "../masters";
import {
  CHANNELS,
  copyPricesFormInput,
  priceListInput,
  type CopyPricesFormInput,
  type PriceListData,
  type PriceListFormInput,
} from "../schemas";
import { EditorDialog, SwitchField } from "./editor-dialog";

type Editing = { kind: "list"; row: PriceListRow | null } | { kind: "copy"; into: PriceListRow };

export function PriceListManager({ rows }: { rows: PriceListRow[] }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing({ kind: "list", row: null })}>
          <Plus /> Nueva lista de precios
        </Button>
      </div>
      <div className="rounded-lg border">
        <Table aria-label="Listas de precios">
          <TableHeader>
            <TableRow>
              <TableHead>Lista</TableHead>
              <TableHead>Canal</TableHead>
              <TableHead className="text-right">Margen objetivo</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Productos con precio</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Clientes</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((l) => (
              <TableRow key={l.id}>
                <TableCell>
                  <button
                    type="button"
                    className="font-medium hover:underline"
                    onClick={() => setEditing({ kind: "list", row: l })}
                    aria-label={`Editar ${l.name}`}
                  >
                    {l.name}
                  </button>
                </TableCell>
                <TableCell>{CHANNEL[l.channel] ?? l.channel}</TableCell>
                <TableCell className="text-right">
                  <Num value={l.targetMarginPct} decimals={1} suffix="%" />
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                  {l.pricedProducts}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{l.customers}</TableCell>
                <TableCell>
                  <StatusBadge tone={l.active ? "good" : "neutral"}>
                    {l.active ? "Activa" : "Inactiva"}
                  </StatusBadge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Copiar precios a ${l.name}`}
                    onClick={() => setEditing({ kind: "copy", into: l })}
                  >
                    <Copy />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing?.kind === "list" ? (
        <ListDialog
          key={editing.row?.id ?? "new"}
          row={editing.row}
          lists={rows}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {editing?.kind === "copy" ? (
        <CopyDialog key={editing.into.id} into={editing.into} lists={rows} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function ListDialog({
  row,
  lists,
  onClose,
}: {
  row: PriceListRow | null;
  lists: PriceListRow[];
  onClose: () => void;
}) {
  const router = useRouter();
  const form = useForm<PriceListFormInput, unknown, PriceListData>({
    resolver: zodResolver(priceListInput),
    defaultValues: {
      name: row?.name ?? "",
      channel: row?.channel ?? "distributor",
      targetMarginPct: toInput(row?.targetMarginPct ?? 25),
      active: row?.active ?? true,
      copyFromListId: null,
      adjustPct: "",
    },
  });
  const copyFrom = useWatch({ control: form.control, name: "copyFromListId" });
  const done = () => {
    onClose();
    router.refresh();
  };
  const create = useAction(createPriceListAction, {
    success: (r) => (r.copied ? `Lista creada con ${r.copied} precios copiados` : "Lista creada"),
    onSuccess: done,
  });
  const update = useAction(updatePriceListAction, { success: "Cambios guardados", onSuccess: done });
  const pending = create.pending || update.pending;
  const fe = row ? update.fieldErrors : create.fieldErrors;
  const err = (n: keyof PriceListFormInput) => form.formState.errors[n]?.message ?? fe[n]?.[0];
  return (
    <EditorDialog
      title={row ? `Editar ${row.name}` : "Nueva lista de precios"}
      description="Una lista por canal (p. ej. distribuidores). Los clientes de ese canal usan su lista."
      onClose={onClose}
    >
      <form
        onSubmit={form.handleSubmit((d) => (row ? update.run({ ...d, id: row.id }) : create.run(d)))}
        className="grid gap-4"
        noValidate
      >
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!err("name")} className="sm:col-span-2">
            <FieldLabel htmlFor="pl-name">Nombre *</FieldLabel>
            <Input id="pl-name" autoFocus {...form.register("name")} />
            <FieldError>{err("name")}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="pl-channel">Canal</FieldLabel>
            <NativeSelect id="pl-channel" {...form.register("channel")}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL[c]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field data-invalid={!!err("targetMarginPct")}>
            <FieldLabel htmlFor="pl-margin">Margen objetivo (%)</FieldLabel>
            <Input id="pl-margin" inputMode="decimal" {...form.register("targetMarginPct")} />
            <FieldError>{err("targetMarginPct")}</FieldError>
          </Field>
          {!row ? (
            <>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="pl-copy">Copiar precios de otra lista</FieldLabel>
                <NativeSelect
                  id="pl-copy"
                  {...form.register("copyFromListId", { setValueAs: (v) => v || null })}
                >
                  <option value="">No copiar (cargo los precios después)</option>
                  {lists
                    .filter((l) => l.active)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              {copyFrom ? (
                <Field data-invalid={!!err("adjustPct")} className="sm:col-span-2">
                  <FieldLabel htmlFor="pl-adjust">Ajuste sobre los precios copiados (%)</FieldLabel>
                  <Input
                    id="pl-adjust"
                    inputMode="decimal"
                    placeholder="+15 o -10"
                    {...form.register("adjustPct")}
                  />
                  <FieldError>{err("adjustPct")}</FieldError>
                </Field>
              ) : null}
            </>
          ) : null}
          <div className="sm:col-span-2">
            <SwitchField control={form.control} name="active" label="Activa" />
          </div>
        </FieldGroup>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {row ? "Guardar cambios" : "Crear lista"}
          </Button>
        </div>
      </form>
    </EditorDialog>
  );
}

function CopyDialog({
  into,
  lists,
  onClose,
}: {
  into: PriceListRow;
  lists: PriceListRow[];
  onClose: () => void;
}) {
  const router = useRouter();
  const form = useForm<CopyPricesFormInput, unknown, z.output<typeof copyPricesFormInput>>({
    resolver: zodResolver(copyPricesFormInput),
    defaultValues: { fromListId: "", adjustPct: "" },
  });
  const act = useAction(copyPricesAction, {
    success: (r) => `${r.copied} precios copiados de ${r.from} a ${r.to}`,
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  const err = (n: "fromListId" | "adjustPct") => form.formState.errors[n]?.message ?? act.fieldErrors[n]?.[0];
  return (
    <EditorDialog
      title={`Copiar precios a ${into.name}`}
      description="Carga un precio nuevo, vigente desde hoy, por cada producto que tenga precio en la lista de origen."
      onClose={onClose}
    >
      <form
        onSubmit={form.handleSubmit((d) => act.run({ ...d, toListId: into.id }))}
        className="grid gap-4"
        noValidate
      >
        <Field data-invalid={!!err("fromListId")}>
          <FieldLabel htmlFor="cp-from">Copiar desde</FieldLabel>
          <NativeSelect id="cp-from" {...form.register("fromListId")}>
            <option value="">Elegí la lista de origen…</option>
            {lists
              .filter((l) => l.id !== into.id)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </NativeSelect>
          <FieldError>{err("fromListId")}</FieldError>
        </Field>
        <Field data-invalid={!!err("adjustPct")}>
          <FieldLabel htmlFor="cp-adjust">Ajuste (%)</FieldLabel>
          <Input id="cp-adjust" inputMode="decimal" placeholder="+15 o -10" {...form.register("adjustPct")} />
          <FieldError>{err("adjustPct")}</FieldError>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={act.pending}>
            Copiar precios
          </Button>
        </div>
      </form>
    </EditorDialog>
  );
}
