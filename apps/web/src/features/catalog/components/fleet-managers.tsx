"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/app/native-select";
import { EmptyState } from "@/components/app/empty-state";
import { Money, Num } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { useAction } from "@/hooks/use-action";
import { toInput } from "@/features/purchases/input";
import {
  createEquipmentAction,
  createLocationAction,
  createVehicleAction,
  updateEquipmentAction,
  updateLocationAction,
  updateVehicleAction,
} from "../actions";
import { EQUIPMENT_KIND, LOCATION_KIND } from "../labels";
import type { EquipmentRow, LocationRow, VehicleRow } from "../masters";
import {
  EQUIPMENT_KINDS,
  LOCATION_KINDS,
  equipmentInput,
  locationInput,
  vehicleInput,
  type EquipmentData,
  type EquipmentFormInput,
  type LocationData,
  type LocationFormInput,
  type VehicleData,
  type VehicleFormInput,
} from "../schemas";
import { EditorDialog, SwitchField } from "./editor-dialog";

const activeBadge = (a: boolean) => (
  <StatusBadge tone={a ? "good" : "neutral"}>{a ? "Activo" : "Inactivo"}</StatusBadge>
);

function Footer({ onClose, pending, label }: { onClose: () => void; pending: boolean; label: string }) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={onClose}>
        Cancelar
      </Button>
      <Button type="submit" disabled={pending}>
        {label}
      </Button>
    </div>
  );
}

// --- Vehículos -----------------------------------------------------------------------------------

export function VehicleManager({ rows }: { rows: VehicleRow[] }) {
  const [editing, setEditing] = useState<VehicleRow | "new" | null>(null);
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus /> Nuevo vehículo
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No hay vehículos" description="Cargá el primer vehículo de reparto." />
      ) : (
        <div className="rounded-lg border">
          <Table aria-label="Vehículos">
            <TableHeader>
              <TableRow>
                <TableHead>Vehículo</TableHead>
                <TableHead>Patente</TableHead>
                <TableHead className="hidden sm:table-cell">Equipo de frío</TableHead>
                <TableHead className="text-right">Costo por km</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      onClick={() => setEditing(v)}
                      aria-label={`Editar ${v.name}`}
                    >
                      {v.name}
                    </button>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{v.plate}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {v.hasColdUnit ? (v.equipmentCode ?? "Sí (sin control de temperatura)") : "No"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={v.costPerKm} />
                  </TableCell>
                  <TableCell>{activeBadge(v.active)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing ? (
        <VehicleDialog
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function VehicleDialog({ row, onClose }: { row: VehicleRow | null; onClose: () => void }) {
  const router = useRouter();
  const form = useForm<VehicleFormInput, unknown, VehicleData>({
    resolver: zodResolver(vehicleInput),
    defaultValues: {
      plate: row?.plate ?? "",
      name: row?.name ?? "",
      hasColdUnit: row?.hasColdUnit ?? true,
      costPerKm: toInput(row?.costPerKm ?? 0),
      createColdEquipment: true,
      active: row?.active ?? true,
    },
  });
  const cold = useWatch({ control: form.control, name: "hasColdUnit" });
  const done = () => {
    onClose();
    router.refresh();
  };
  const create = useAction(createVehicleAction, { success: "Vehículo creado", onSuccess: done });
  const update = useAction(updateVehicleAction, { success: "Cambios guardados", onSuccess: done });
  const fe = row ? update.fieldErrors : create.fieldErrors;
  const err = (n: keyof VehicleFormInput) => form.formState.errors[n]?.message ?? fe[n]?.[0];
  return (
    <EditorDialog
      title={row ? `Editar ${row.name}` : "Nuevo vehículo"}
      description="Se usa en las rutas de reparto; el costo por km alimenta el costo de reparto."
      onClose={onClose}
    >
      <form
        onSubmit={form.handleSubmit((d) => (row ? update.run({ ...d, id: row.id }) : create.run(d)))}
        className="grid gap-4"
        noValidate
      >
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!err("name")} className="sm:col-span-2">
            <FieldLabel htmlFor="veh-name">Nombre *</FieldLabel>
            <Input
              id="veh-name"
              autoFocus
              placeholder="Utilitario con equipo de frío"
              {...form.register("name")}
            />
            <FieldError>{err("name")}</FieldError>
          </Field>
          <Field data-invalid={!!err("plate")}>
            <FieldLabel htmlFor="veh-plate">Patente *</FieldLabel>
            <Input id="veh-plate" placeholder="AB123CD" {...form.register("plate")} />
            <FieldError>{err("plate")}</FieldError>
          </Field>
          <Field data-invalid={!!err("costPerKm")}>
            <FieldLabel htmlFor="veh-km">Costo por km</FieldLabel>
            <Input id="veh-km" inputMode="decimal" {...form.register("costPerKm")} />
            <FieldError>{err("costPerKm")}</FieldError>
          </Field>
          <div className="grid gap-3 sm:col-span-2">
            <SwitchField control={form.control} name="hasColdUnit" label="Tiene equipo de frío" />
            {cold && !row ? (
              <SwitchField
                control={form.control}
                name="createColdEquipment"
                label="Dar de alta su equipo de frío"
                hint="Se controla su temperatura al cerrar la ruta y entra en el mantenimiento."
              />
            ) : null}
            <SwitchField control={form.control} name="active" label="Activo" />
          </div>
        </FieldGroup>
        <Footer
          onClose={onClose}
          pending={create.pending || update.pending}
          label={row ? "Guardar cambios" : "Crear vehículo"}
        />
      </form>
    </EditorDialog>
  );
}

// --- Equipos -------------------------------------------------------------------------------------

export function EquipmentManager({
  rows,
  locations,
}: {
  rows: EquipmentRow[];
  locations: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState<EquipmentRow | "new" | null>(null);
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus /> Nuevo equipo
        </Button>
      </div>
      <div className="rounded-lg border">
        <Table aria-label="Equipos">
          <TableHeader>
            <TableRow>
              <TableHead>Equipo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="hidden sm:table-cell">Área</TableHead>
              <TableHead className="text-right">Temperatura</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <button
                    type="button"
                    className="font-medium hover:underline"
                    onClick={() => setEditing(e)}
                    aria-label={`Editar ${e.name}`}
                  >
                    {e.name}
                  </button>
                  <div className="text-muted-foreground text-xs">{e.code}</div>
                </TableCell>
                <TableCell>{EQUIPMENT_KIND[e.kind]}</TableCell>
                <TableCell className="hidden sm:table-cell">{e.area}</TableCell>
                <TableCell className="text-right">
                  {e.tempMinC == null && e.tempMaxC == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <>
                      {e.tempMinC != null ? <Num value={e.tempMinC} decimals={0} suffix="°C" /> : "…"} a{" "}
                      {e.tempMaxC != null ? <Num value={e.tempMaxC} decimals={0} suffix="°C" /> : "…"}
                    </>
                  )}
                </TableCell>
                <TableCell>{activeBadge(e.active)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing ? (
        <EquipmentDialog
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? null : editing}
          locations={locations}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function EquipmentDialog({
  row,
  locations,
  onClose,
}: {
  row: EquipmentRow | null;
  locations: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const form = useForm<EquipmentFormInput, unknown, EquipmentData>({
    resolver: zodResolver(equipmentInput),
    defaultValues: {
      code: row?.code ?? "",
      name: row?.name ?? "",
      area: row?.area ?? "Congelado",
      kind: row?.kind ?? "freezer",
      tempMinC: toInput(row?.tempMinC),
      tempMaxC: toInput(row?.tempMaxC ?? (row ? null : -18)),
      locationId: row?.locationId ?? null,
      active: row?.active ?? true,
    },
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  const done = () => {
    onClose();
    router.refresh();
  };
  const create = useAction(createEquipmentAction, { success: "Equipo creado", onSuccess: done });
  const update = useAction(updateEquipmentAction, { success: "Cambios guardados", onSuccess: done });
  const fe = row ? update.fieldErrors : create.fieldErrors;
  const err = (n: keyof EquipmentFormInput) => form.formState.errors[n]?.message ?? fe[n]?.[0];
  return (
    <EditorDialog
      title={row ? `Editar ${row.name}` : "Nuevo equipo"}
      description="Los freezers, heladeras y equipos de frío activos aparecen para cargar temperaturas; todos, en el mantenimiento."
      onClose={onClose}
    >
      <form
        onSubmit={form.handleSubmit((d) => (row ? update.run({ ...d, id: row.id }) : create.run(d)))}
        className="grid gap-4"
        noValidate
      >
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!err("code")}>
            <FieldLabel htmlFor="eq-code">Código *</FieldLabel>
            <Input id="eq-code" autoFocus placeholder="F5" {...form.register("code")} />
            <FieldError>{err("code")}</FieldError>
          </Field>
          <Field data-invalid={!!err("name")}>
            <FieldLabel htmlFor="eq-name">Nombre *</FieldLabel>
            <Input id="eq-name" {...form.register("name")} />
            <FieldError>{err("name")}</FieldError>
          </Field>
          <Field data-invalid={!!err("area")}>
            <FieldLabel htmlFor="eq-area">Área *</FieldLabel>
            <Input id="eq-area" {...form.register("area")} />
            <FieldError>{err("area")}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="eq-kind">Tipo</FieldLabel>
            <NativeSelect id="eq-kind" {...form.register("kind")}>
              {EQUIPMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {EQUIPMENT_KIND[k]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {kind === "freezer" || kind === "fridge" || kind === "vehicle" ? (
            <>
              <Field data-invalid={!!err("tempMinC")}>
                <FieldLabel htmlFor="eq-min">Temperatura mínima (°C)</FieldLabel>
                <Input
                  id="eq-min"
                  inputMode="decimal"
                  placeholder="Sin mínimo"
                  {...form.register("tempMinC")}
                />
                <FieldError>{err("tempMinC")}</FieldError>
              </Field>
              <Field data-invalid={!!err("tempMaxC")}>
                <FieldLabel htmlFor="eq-max">Temperatura máxima (°C)</FieldLabel>
                <Input id="eq-max" inputMode="decimal" placeholder="-18" {...form.register("tempMaxC")} />
                <FieldError>{err("tempMaxC")}</FieldError>
              </Field>
            </>
          ) : null}
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="eq-loc">Ubicación de stock (opcional)</FieldLabel>
            <NativeSelect id="eq-loc" {...form.register("locationId", { setValueAs: (v) => v || null })}>
              <option value="">Ninguna</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="sm:col-span-2">
            <SwitchField control={form.control} name="active" label="Activo" />
          </div>
        </FieldGroup>
        <Footer
          onClose={onClose}
          pending={create.pending || update.pending}
          label={row ? "Guardar cambios" : "Crear equipo"}
        />
      </form>
    </EditorDialog>
  );
}

// --- Ubicaciones ---------------------------------------------------------------------------------

export function LocationManager({ rows }: { rows: LocationRow[] }) {
  const [editing, setEditing] = useState<LocationRow | "new" | null>(null);
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus /> Nueva ubicación
        </Button>
      </div>
      <div className="rounded-lg border">
        <Table aria-label="Ubicaciones">
          <TableHeader>
            <TableRow>
              <TableHead>Ubicación</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Capacidad</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((l) => (
              <TableRow key={l.id}>
                <TableCell>
                  <button
                    type="button"
                    className="font-medium hover:underline"
                    onClick={() => setEditing(l)}
                    aria-label={`Editar ${l.name}`}
                  >
                    {l.name}
                  </button>
                  <div className="text-muted-foreground text-xs">{l.code}</div>
                </TableCell>
                <TableCell>{LOCATION_KIND[l.kind]}</TableCell>
                <TableCell className="hidden text-right sm:table-cell">
                  <Num value={l.capacityKg} decimals={0} suffix="kg" />
                </TableCell>
                <TableCell>{activeBadge(l.active)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing ? (
        <LocationDialog
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function LocationDialog({ row, onClose }: { row: LocationRow | null; onClose: () => void }) {
  const router = useRouter();
  const form = useForm<LocationFormInput, unknown, LocationData>({
    resolver: zodResolver(locationInput),
    defaultValues: {
      code: row?.code ?? "",
      name: row?.name ?? "",
      kind: row?.kind ?? "finished",
      capacityKg: toInput(row?.capacityKg),
      createEquipment: "none",
      active: row?.active ?? true,
    },
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  const done = () => {
    onClose();
    router.refresh();
  };
  const create = useAction(createLocationAction, { success: "Ubicación creada", onSuccess: done });
  const update = useAction(updateLocationAction, { success: "Cambios guardados", onSuccess: done });
  const fe = row ? update.fieldErrors : create.fieldErrors;
  const err = (n: keyof LocationFormInput) => form.formState.errors[n]?.message ?? fe[n]?.[0];
  return (
    <EditorDialog
      title={row ? `Editar ${row.name}` : "Nueva ubicación"}
      description="Depósitos, freezers de producto terminado y heladeras donde se guarda stock."
      onClose={onClose}
    >
      <form
        onSubmit={form.handleSubmit((d) => (row ? update.run({ ...d, id: row.id }) : create.run(d)))}
        className="grid gap-4"
        noValidate
      >
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!err("code")}>
            <FieldLabel htmlFor="loc-code">Código *</FieldLabel>
            <Input id="loc-code" autoFocus placeholder="F5" {...form.register("code")} />
            <FieldError>{err("code")}</FieldError>
          </Field>
          <Field data-invalid={!!err("name")}>
            <FieldLabel htmlFor="loc-name">Nombre *</FieldLabel>
            <Input id="loc-name" {...form.register("name")} />
            <FieldError>{err("name")}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="loc-kind">Tipo</FieldLabel>
            {row ? (
              <p id="loc-kind" className="text-sm">
                {LOCATION_KIND[row.kind]} <span className="text-muted-foreground">(no se puede cambiar)</span>
              </p>
            ) : (
              <NativeSelect id="loc-kind" {...form.register("kind")}>
                {LOCATION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {LOCATION_KIND[k]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field data-invalid={!!err("capacityKg")}>
            <FieldLabel htmlFor="loc-cap">Capacidad (kg)</FieldLabel>
            <Input id="loc-cap" inputMode="decimal" {...form.register("capacityKg")} />
            <FieldError>{err("capacityKg")}</FieldError>
          </Field>
          {!row && (kind === "finished" || kind === "raw") ? (
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="loc-eq">Control de temperatura</FieldLabel>
              <NativeSelect id="loc-eq" {...form.register("createEquipment")}>
                <option value="none">Sin equipo (solo guarda stock)</option>
                <option value="freezer">Es un freezer (hasta -18 °C)</option>
                <option value="fridge">Es una heladera (hasta 5 °C)</option>
              </NativeSelect>
              <p className="text-muted-foreground text-xs">
                Se da de alta también el equipo: aparece para cargar temperaturas y en el mantenimiento.
              </p>
            </Field>
          ) : null}
          <div className="sm:col-span-2">
            <SwitchField control={form.control} name="active" label="Activa" />
          </div>
        </FieldGroup>
        <Footer
          onClose={onClose}
          pending={create.pending || update.pending}
          label={row ? "Guardar cambios" : "Crear ubicación"}
        />
      </form>
    </EditorDialog>
  );
}
