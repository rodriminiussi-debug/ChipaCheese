"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState } from "@/components/app/empty-state";
import { useAction } from "@/hooks/use-action";
import { WEEKDAY_LABELS } from "@/lib/dates";
import { createZoneAction, deleteZoneAction, updateZoneAction } from "../actions";
import type { ZoneRow } from "../masters";
import { zoneInput, type ZoneData, type ZoneFormInput } from "../schemas";
import { EditorDialog } from "./editor-dialog";

const days = (d: number[]) => (d.length ? d.map((x) => WEEKDAY_LABELS[x]).join(", ") : "Sin días fijos");

export function ZoneManager({ rows }: { rows: ZoneRow[] }) {
  const [editing, setEditing] = useState<ZoneRow | "new" | null>(null);
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus /> Nueva zona
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No hay zonas" description="Cargá la primera zona de reparto." />
      ) : (
        <div className="rounded-lg border">
          <Table aria-label="Zonas de reparto">
            <TableHeader>
              <TableRow>
                <TableHead>Zona</TableHead>
                <TableHead>Días de reparto</TableHead>
                <TableHead className="text-right">Clientes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((z) => (
                <TableRow key={z.id}>
                  <TableCell>
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      onClick={() => setEditing(z)}
                      aria-label={`Editar ${z.name}`}
                    >
                      {z.name}
                    </button>
                  </TableCell>
                  <TableCell>{days(z.deliveryWeekdays)}</TableCell>
                  <TableCell className="text-right tabular-nums">{z.customers}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing ? (
        <ZoneDialog
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function ZoneDialog({ row, onClose }: { row: ZoneRow | null; onClose: () => void }) {
  const router = useRouter();
  const form = useForm<ZoneFormInput, unknown, ZoneData>({
    resolver: zodResolver(zoneInput),
    defaultValues: { name: row?.name ?? "", deliveryWeekdays: row?.deliveryWeekdays ?? [] },
  });
  const done = () => {
    onClose();
    router.refresh();
  };
  const create = useAction(createZoneAction, { success: "Zona creada", onSuccess: done });
  const update = useAction(updateZoneAction, { success: "Cambios guardados", onSuccess: done });
  const remove = useAction(deleteZoneAction, { success: "Zona borrada", onSuccess: done });
  const pending = create.pending || update.pending || remove.pending;
  const fe = row ? update.fieldErrors : create.fieldErrors;
  const nameErr = form.formState.errors.name?.message ?? fe.name?.[0];
  return (
    <EditorDialog
      title={row ? `Editar ${row.name}` : "Nueva zona de reparto"}
      description="Los días son los de reparto de la zona; cada cliente puede tener los suyos."
      onClose={onClose}
    >
      <form
        onSubmit={form.handleSubmit((d) => (row ? update.run({ ...d, id: row.id }) : create.run(d)))}
        className="grid gap-4"
        noValidate
      >
        <Field data-invalid={!!nameErr}>
          <FieldLabel htmlFor="zone-name">Nombre *</FieldLabel>
          <Input id="zone-name" autoFocus {...form.register("name")} />
          <FieldError>{nameErr}</FieldError>
        </Field>
        <Field>
          <FieldLabel>Días de reparto</FieldLabel>
          <Controller
            control={form.control}
            name="deliveryWeekdays"
            render={({ field }) => (
              <ToggleGroup
                type="multiple"
                variant="outline"
                value={(field.value ?? []).map(String)}
                onValueChange={(v) => field.onChange(v.map(Number).sort())}
              >
                {[1, 2, 3, 4, 5, 6].map((d) => (
                  <ToggleGroupItem key={d} value={String(d)} aria-label={WEEKDAY_LABELS[d]}>
                    {WEEKDAY_LABELS[d]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          {row ? (
            <Button
              type="button"
              variant="outline"
              className="text-destructive"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`¿Borrar la zona ${row.name}?`)) remove.run({ id: row.id });
              }}
            >
              Borrar
            </Button>
          ) : null}
          <Button type="submit" disabled={pending}>
            {row ? "Guardar cambios" : "Crear zona"}
          </Button>
        </div>
      </form>
    </EditorDialog>
  );
}
