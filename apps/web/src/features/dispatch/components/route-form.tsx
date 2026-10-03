"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { formatKg } from "@chipa/domain";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText } from "@/components/app/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { createRouteAction } from "../actions";
import { weekdayDate, weekdaysText } from "../labels";
import type { DispatchFormOptions, RouteProposal } from "../service";

const NONE = "__none__";

/**
 * RF-24: arma la ruta del día. Propone los pedidos por zona (los listos vienen tildados en las zonas
 * que reparten ese día), deja agregar retiros en proveedores y asignar chofer y vehículo.
 */
export function RouteForm({ proposal, options }: { proposal: RouteProposal; options: DispatchFormOptions }) {
  const router = useRouter();
  const { date } = proposal;
  const orders = useMemo(() => proposal.zones.flatMap((z) => z.orders), [proposal]);
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        proposal.zones
          .filter((z) => z.deliversOnDate)
          .flatMap((z) => z.orders.filter((o) => o.ready).map((o) => o.id)),
      ),
  );
  const [driverId, setDriverId] = useState(options.drivers.length === 1 ? options.drivers[0]!.id : NONE);
  const [vehicleId, setVehicleId] = useState(options.vehicles.length === 1 ? options.vehicles[0]!.id : NONE);
  const [notes, setNotes] = useState("");
  // RF-10: retiros de OC marcadas "retiro en proveedor" cuya fecha esperada ya llegó, tildados de entrada.
  const [suggested, setSuggested] = useState<Set<string>>(
    () => new Set(proposal.pickups.map((p) => p.orderId)),
  );
  const [pickups, setPickups] = useState<{ supplierId: string; notes: string }[]>([]);
  const [newSupplier, setNewSupplier] = useState(NONE);
  const [newNote, setNewNote] = useState("");

  const create = useAction(createRouteAction, {
    success: "Ruta creada",
    onSuccess: (r) => router.push(`/despacho/rutas/${r.id}`),
  });

  const chosen = orders.filter((o) => selected.has(o.id));
  const kg = chosen.reduce((a, o) => a + o.kg, 0);
  const units = chosen.reduce((a, o) => a + o.units, 0);
  const notReady = chosen.filter((o) => !o.ready).length;
  const chosenSuggestions = proposal.pickups.filter((p) => suggested.has(p.orderId));
  const stopCount = pickups.length + chosenSuggestions.length;
  const supplierName = (id: string) => options.suppliers.find((s) => s.id === id)?.name ?? "Proveedor";

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function addPickup() {
    if (newSupplier === NONE) return;
    setPickups((p) => [...p, { supplierId: newSupplier, notes: newNote.trim() }]);
    setNewSupplier(NONE);
    setNewNote("");
  }

  function submit() {
    create.run({
      date,
      driverId: driverId === NONE ? null : driverId,
      vehicleId: vehicleId === NONE ? null : vehicleId,
      orderIds: chosen.map((o) => o.id),
      supplierStops: [
        ...chosenSuggestions.map((p) => ({ supplierId: p.supplierId, notes: p.note })),
        ...pickups.map((p) => ({ supplierId: p.supplierId, notes: p.notes || null })),
      ],
      notes: notes.trim() || null,
    });
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Salida del {weekdayDate(date)}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="route-driver">Chofer</Label>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger id="route-driver" className="w-full">
                <SelectValue placeholder="Elegí el chofer" />
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
            <Label htmlFor="route-vehicle">Vehículo</Label>
            <Select value={vehicleId} onValueChange={setVehicleId}>
              <SelectTrigger id="route-vehicle" className="w-full">
                <SelectValue placeholder="Elegí el vehículo" />
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
        </CardContent>
      </Card>

      <section className="grid gap-3" aria-label="Pedidos por zona">
        <h2 className="text-sm font-semibold">Pedidos para entregar (fecha comprometida hasta hoy)</h2>
        {proposal.zones.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            No hay pedidos listos, confirmados ni en producción con fecha comprometida hasta el{" "}
            <DateText value={date} />. Podés armar la ruta solo con retiros en proveedores.
          </p>
        ) : null}
        {proposal.zones.map((z) => (
          <Card key={z.zoneId ?? "none"} data-testid="zone-group">
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {z.name}
                {z.zoneId ? (
                  <span className="text-muted-foreground text-xs font-normal">
                    Reparte: {weekdaysText(z.weekdays)}
                  </span>
                ) : null}
              </CardTitle>
              {!z.deliversOnDate ? (
                <p
                  className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400"
                  role="status"
                >
                  <AlertTriangle className="size-4" />
                  {z.name} no tiene reparto los {weekdayName(date)}: tildá los pedidos solo si querés
                  llevarlos igual.
                </p>
              ) : null}
            </CardHeader>
            <CardContent className="grid gap-2">
              {z.orders.map((o) => (
                <label
                  key={o.id}
                  data-testid="proposal-order"
                  className="has-[[data-state=checked]]:bg-muted/50 flex cursor-pointer items-start gap-3 rounded-md border p-3"
                >
                  <Checkbox
                    checked={selected.has(o.id)}
                    onCheckedChange={(v) => toggle(o.id, v === true)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        #{o.number} {o.customerName}
                      </span>
                      {o.ready ? (
                        <StatusBadge tone="good">Listo</StatusBadge>
                      ) : (
                        <StatusBadge tone="warn">No listo</StatusBadge>
                      )}
                      {o.promisedDate < date ? <StatusBadge tone="bad">Atrasado</StatusBadge> : null}
                    </span>
                    <span className="text-muted-foreground block text-sm">
                      {formatKg(o.kg)} · {o.units} bultos · para el <DateText value={o.promisedDate} />
                      {o.address ? ` · ${o.address}` : ""}
                    </span>
                  </span>
                </label>
              ))}
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Retiros en proveedores</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {proposal.pickups.length ? (
            <div className="grid gap-2" role="group" aria-label="Retiros sugeridos por órdenes de compra">
              <p className="text-sm font-medium">Sugeridos por órdenes de compra con retiro</p>
              {proposal.pickups.map((p) => (
                <label
                  key={p.orderId}
                  data-testid="proposal-pickup"
                  className="has-[[data-state=checked]]:bg-muted/50 flex cursor-pointer items-start gap-3 rounded-md border p-3"
                >
                  <Checkbox
                    checked={suggested.has(p.orderId)}
                    aria-label={`Retirar ${p.number} en ${p.supplierName}`}
                    onCheckedChange={(v) =>
                      setSuggested((prev) => {
                        const next = new Set(prev);
                        if (v === true) next.add(p.orderId);
                        else next.delete(p.orderId);
                        return next;
                      })
                    }
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {p.number} · {p.supplierName}
                      </span>
                      {p.expectedAt < date ? <StatusBadge tone="bad">Atrasada</StatusBadge> : null}
                    </span>
                    <span className="text-muted-foreground block text-sm">
                      Esperada el <DateText value={p.expectedAt} /> · {p.summary}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {pickups.length ? (
            <ul className="grid gap-2">
              {pickups.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                  <span>
                    <span className="font-medium">{supplierName(p.supplierId)}</span>
                    {p.notes ? <span className="text-muted-foreground"> — {p.notes}</span> : null}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Quitar retiro en ${supplierName(p.supplierId)}`}
                    onClick={() => setPickups((all) => all.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              Sumá los proveedores donde hay que retirar insumos durante el reparto.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="pickup-supplier">Proveedor</Label>
              <Select value={newSupplier} onValueChange={setNewSupplier}>
                <SelectTrigger id="pickup-supplier" className="w-full">
                  <SelectValue placeholder="Elegí el proveedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} disabled>
                    Elegí el proveedor
                  </SelectItem>
                  {options.suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pickup-note">Nota del retiro</Label>
              <Input
                id="pickup-note"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Ej.: retirar 25 kg de fécula"
              />
            </div>
            <Button type="button" variant="outline" onClick={addPickup} disabled={newSupplier === NONE}>
              <Plus /> Agregar retiro
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-1.5">
        <Label htmlFor="route-notes">Observaciones</Label>
        <Textarea id="route-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>

      <div className="bg-background sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 md:static md:mx-0 md:border-0 md:px-0">
        <p className="text-sm" data-testid="route-totals">
          <span className="font-semibold">
            {chosen.length} {chosen.length === 1 ? "entrega" : "entregas"}
            {stopCount ? ` + ${stopCount} ${stopCount === 1 ? "retiro" : "retiros"}` : ""}
          </span>{" "}
          · {formatKg(kg)} · {units} bultos
          {notReady ? (
            <span className="ml-2 text-amber-700 dark:text-amber-400">
              ({notReady} {notReady === 1 ? "pedido no está listo" : "pedidos no están listos"})
            </span>
          ) : null}
        </p>
        <Button
          size="lg"
          className="h-11 px-6 text-base"
          disabled={create.pending || (chosen.length === 0 && stopCount === 0)}
          onClick={submit}
        >
          Crear ruta
        </Button>
      </div>
    </div>
  );
}

const WEEKDAY_NAMES = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"];
function weekdayName(date: string) {
  // Se calcula acá con la misma convención ISO que el dominio (1 = lunes).
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return WEEKDAY_NAMES[d === 0 ? 7 : d] ?? "";
}
