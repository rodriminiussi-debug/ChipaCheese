"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, FileText, Flag, Play, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { formatARS, formatNumber } from "@chipa/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { OFFLINE_ACTION } from "@/components/pwa/offline-actions";
import { useAction } from "@/hooks/use-action";
import { useOfflineAction, useQueuedItems } from "@/hooks/use-offline-action";
import { formatDateTimeAR } from "@/lib/dates";
import {
  addSupplierStopAction,
  finishRouteAction,
  generateRouteDispatchesAction,
  startRouteAction,
  updateRouteAction,
} from "../actions";
import { timeHM } from "../labels";
import type { FinishRoutePayload, StartRoutePayload } from "../schemas";
import type { DispatchFormOptions } from "../service";

const NONE = "__none__";

/** Chofer, vehículo y observaciones de la ruta (mientras está planificada o en curso). */
export function RouteAssign({
  routeId,
  driverId,
  vehicleId,
  notes,
  options,
}: {
  routeId: string;
  driverId: string | null;
  vehicleId: string | null;
  notes: string | null;
  options: DispatchFormOptions;
}) {
  const router = useRouter();
  const [driver, setDriver] = useState(driverId ?? NONE);
  const [vehicle, setVehicle] = useState(vehicleId ?? NONE);
  const [note, setNote] = useState(notes ?? "");
  const save = useAction(updateRouteAction, {
    success: "Ruta actualizada",
    onSuccess: () => router.refresh(),
  });
  const dirty = driver !== (driverId ?? NONE) || vehicle !== (vehicleId ?? NONE) || note !== (notes ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Chofer y vehículo</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="assign-driver">Chofer</Label>
          <Select value={driver} onValueChange={setDriver}>
            <SelectTrigger id="assign-driver" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Sin asignar</SelectItem>
              {options.drivers.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="assign-vehicle">Vehículo</Label>
          <Select value={vehicle} onValueChange={setVehicle}>
            <SelectTrigger id="assign-vehicle" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Sin asignar</SelectItem>
              {options.vehicles.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name} ({v.plate})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="assign-notes">Observaciones</Label>
          <Textarea id="assign-notes" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </div>
        <div className="sm:col-span-2">
          <Button
            variant="outline"
            className="h-11"
            disabled={!dirty || save.pending}
            onClick={() =>
              save.run({
                id: routeId,
                driverId: driver === NONE ? null : driver,
                vehicleId: vehicle === NONE ? null : vehicle,
                notes: note || null,
              })
            }
          >
            <Save /> Guardar cambios
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** RF-25: genera los remitos (lotes por FEFO) de todos los pedidos listos de la ruta. */
export function GenerateAllDispatches({ routeId, pending }: { routeId: string; pending: number }) {
  const router = useRouter();
  const act = useAction(generateRouteDispatchesAction, {
    onSuccess: (r) => {
      if (r.created.length) toast.success(`Remitos generados: ${r.created.map((c) => c.number).join(", ")}`);
      for (const f of r.failed) toast.error(`#${f.orderNumber} ${f.customerName}: ${f.reason}`);
      router.refresh();
    },
  });
  return (
    <Button
      className="h-11 text-base"
      disabled={act.pending || pending === 0}
      onClick={() => act.run({ routeId })}
    >
      <FileText /> Generar remitos de la ruta{pending ? ` (${pending})` : ""}
    </Button>
  );
}

/** RF-24: retiro en proveedor agregado a mano. */
export function AddSupplierStop({
  routeId,
  suppliers,
}: {
  routeId: string;
  suppliers: DispatchFormOptions["suppliers"];
}) {
  const router = useRouter();
  const [supplier, setSupplier] = useState(NONE);
  const [note, setNote] = useState("");
  const act = useAction(addSupplierStopAction, {
    success: "Retiro agregado a la ruta",
    onSuccess: () => {
      setSupplier(NONE);
      setNote("");
      router.refresh();
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Agregar retiro en proveedor</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="stop-supplier">Proveedor</Label>
          <Select value={supplier} onValueChange={setSupplier}>
            <SelectTrigger id="stop-supplier" className="h-11 w-full">
              <SelectValue placeholder="Elegí el proveedor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE} disabled>
                Elegí el proveedor
              </SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="stop-note">Nota</Label>
          <Input
            id="stop-note"
            className="h-11"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej.: retirar 25 kg de fécula"
          />
        </div>
        <Button
          variant="outline"
          className="h-11"
          disabled={supplier === NONE || act.pending}
          onClick={() => act.run({ routeId, supplierId: supplier, notes: note || null })}
        >
          <Plus /> Agregar
        </Button>
      </CardContent>
    </Card>
  );
}

export interface RunPanelRoute {
  id: string;
  status: string;
  vehicleName: string | null;
  hasColdUnit: boolean;
  kmStart: number | null;
  kmEnd: number | null;
  startedAt: string | null;
  endedAt: string | null;
  fuelLiters: number | null;
  fuelCost: number | null;
  otherCosts: number | null;
  coldUnitTempC: number | null;
  suggestedKmStart: number | null;
  pendingDispatches: number;
  /** Km, horas y costo si la ruta está cerrada. */
  hours: number | null;
}

function Summary({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * RF-26: registro de salida. Planificada → inicio (km inicial y hora); en curso → cierre (km final,
 * combustible, otros costos y temperatura del equipo de frío); cerrada → resumen.
 */
export function RouteRunPanel({ route, canWrite }: { route: RunPanelRoute; canWrite: boolean }) {
  const router = useRouter();
  const [kmStart, setKmStart] = useState(
    route.suggestedKmStart != null ? String(route.suggestedKmStart) : "",
  );
  const [form, setForm] = useState({
    kmEnd: "",
    fuelLiters: "",
    fuelCost: "",
    otherCosts: "",
    coldUnitTempC: "",
    notes: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  // Sin señal en la calle: la salida y el cierre quedan en la cola del celular y se envían al volver la conexión.
  const start = useOfflineAction(OFFLINE_ACTION.routeStart, startRouteAction, {
    success: "Ruta iniciada",
    onSuccess: (_d, queued) => {
      if (!queued) router.refresh();
    },
  });
  const finish = useOfflineAction(OFFLINE_ACTION.routeFinish, finishRouteAction, {
    success: "Ruta cerrada",
    onSuccess: (_d, queued) => {
      if (!queued) router.refresh();
    },
  });
  const fe = finish.fieldErrors;
  const queuedStart = useQueuedItems<StartRoutePayload>(OFFLINE_ACTION.routeStart).filter(
    (q) => q.payload.id === route.id,
  );
  const queuedFinish = useQueuedItems<FinishRoutePayload>(OFFLINE_ACTION.routeFinish).filter(
    (q) => q.payload.id === route.id,
  );
  const pendingStart = queuedStart.at(-1)?.payload;

  if (route.status === "done")
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Salida registrada</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" data-testid="run-summary">
            <Summary label="Salida" value={route.startedAt ? formatDateTimeAR(route.startedAt) : "—"} />
            <Summary label="Regreso" value={route.endedAt ? formatDateTimeAR(route.endedAt) : "—"} />
            <Summary label="Km" value={`${route.kmStart ?? "—"} → ${route.kmEnd ?? "—"}`} />
            <Summary label="Horas" value={route.hours != null ? formatNumber(route.hours, 2) : "—"} />
            <Summary
              label="Combustible"
              value={
                route.fuelLiters != null || route.fuelCost != null
                  ? `${route.fuelLiters != null ? `${formatNumber(route.fuelLiters, 1)} L` : ""} ${route.fuelCost != null ? formatARS(route.fuelCost) : ""}`
                  : "—"
              }
            />
            <Summary
              label="Otros costos"
              value={route.otherCosts != null ? formatARS(route.otherCosts) : "—"}
            />
            <Summary
              label="Temperatura del equipo de frío"
              value={route.coldUnitTempC != null ? `${formatNumber(route.coldUnitTempC, 1)} °C` : "—"}
            />
          </dl>
        </CardContent>
      </Card>
    );

  if (route.status === "cancelled") return null;
  if (!canWrite) {
    return route.status === "in_progress" ? (
      <p className="text-muted-foreground text-sm">
        Salió {route.startedAt ? timeHM(route.startedAt) : ""} con {route.kmStart} km.
      </p>
    ) : null;
  }

  // Cierre guardado sin señal: queda a la espera de la conexión.
  if (queuedFinish.length > 0)
    return (
      <Card className="border-amber-500 bg-amber-50 dark:bg-amber-950/30" data-testid="route-finish-pending">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CloudOff className="size-4" /> Cierre de la ruta pendiente de enviar
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          Km final {String(queuedFinish.at(-1)!.payload.kmEnd)}. Quedó guardado en este celular y se envía
          solo al volver la señal.
        </CardContent>
      </Card>
    );

  if (route.status === "planned" && !pendingStart)
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Iniciar la salida</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="km-start">Km inicial (tablero)</Label>
            <Input
              id="km-start"
              inputMode="decimal"
              className="h-11 text-base"
              value={kmStart}
              onChange={(e) => setKmStart(e.target.value)}
              placeholder="Ej.: 12000"
            />
            {start.fieldErrors.kmStart?.[0] ? (
              <p className="text-destructive text-sm">{start.fieldErrors.kmStart[0]}</p>
            ) : null}
          </div>
          <Button
            size="lg"
            className="h-11 text-base"
            disabled={start.pending || kmStart.trim() === ""}
            onClick={() =>
              start.run({
                id: route.id,
                kmStart,
                clientId: crypto.randomUUID(),
                recordedAt: new Date().toISOString(),
              })
            }
          >
            <Play /> Iniciar ruta
          </Button>
          {!route.vehicleName ? (
            <p className="text-sm text-amber-700 sm:col-span-2 dark:text-amber-400">
              Asigná un vehículo antes de iniciar la ruta.
            </p>
          ) : null}
        </CardContent>
      </Card>
    );

  // in_progress (o planificada con la salida ya guardada sin señal)
  const startedAt = route.startedAt ?? pendingStart?.recordedAt ?? null;
  const startKm = route.kmStart ?? pendingStart?.kmStart ?? null;
  const field = (
    id: string,
    label: string,
    key: keyof typeof form,
    opts: { placeholder?: string; error?: string } = {},
  ) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="decimal"
        className="h-11 text-base"
        value={form[key]}
        onChange={set(key)}
        placeholder={opts.placeholder}
        aria-invalid={!!opts.error}
      />
      {opts.error ? <p className="text-destructive text-sm">{opts.error}</p> : null}
    </div>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          En curso — salió {startedAt ? timeHM(startedAt) : ""} con {startKm} km
          {pendingStart && route.status === "planned" ? (
            <span className="ml-2 inline-flex items-center gap-1 text-sm font-normal text-amber-700 dark:text-amber-400">
              <CloudOff className="size-4" /> salida pendiente de enviar
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {route.pendingDispatches > 0 ? (
          <p className="text-sm text-amber-700 dark:text-amber-400" role="status">
            Quedan {route.pendingDispatches} {route.pendingDispatches === 1 ? "remito" : "remitos"} sin
            entregar ni rechazar: resolvelos antes de cerrar la ruta.
          </p>
        ) : null}
        <p className="text-muted-foreground text-sm">Al volver, cargá los datos para cerrar la ruta.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("km-end", "Km final (tablero)", "kmEnd", { error: fe.kmEnd?.[0] })}
          {field(
            "cold-temp",
            route.hasColdUnit ? "Temperatura del equipo de frío (°C)" : "Temperatura (°C, opcional)",
            "coldUnitTempC",
            { placeholder: "Ej.: -20", error: fe.coldUnitTempC?.[0] },
          )}
          {field("fuel-liters", "Combustible (litros)", "fuelLiters", { error: fe.fuelLiters?.[0] })}
          {field("fuel-cost", "Combustible ($)", "fuelCost", { error: fe.fuelCost?.[0] })}
          {field("other-costs", "Otros costos ($): peajes, estacionamiento…", "otherCosts", {
            error: fe.otherCosts?.[0],
          })}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="finish-notes">Observaciones</Label>
          <Textarea id="finish-notes" rows={2} value={form.notes} onChange={set("notes")} />
        </div>
        <Button
          size="lg"
          className="h-12 text-base"
          disabled={finish.pending || form.kmEnd.trim() === ""}
          onClick={() =>
            finish.run({
              id: route.id,
              clientId: crypto.randomUUID(),
              recordedAt: new Date().toISOString(),
              kmEnd: form.kmEnd,
              fuelLiters: form.fuelLiters,
              fuelCost: form.fuelCost,
              otherCosts: form.otherCosts,
              coldUnitTempC: form.coldUnitTempC,
              notes: form.notes || null,
            })
          }
        >
          <Flag /> Cerrar ruta
        </Button>
      </CardContent>
    </Card>
  );
}
