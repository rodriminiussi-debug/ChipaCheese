"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Snowflake } from "lucide-react";
import { MAX_REFRIGERATED_TEMP_C, formatNumber, isTemperatureAlert, parseDecimalAR } from "@chipa/domain";
import { NativeSelect } from "@/components/app/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-action";
import { UNIT } from "@/lib/labels";
import { createReceptionAction } from "../actions";
import type { ReceptionFormData } from "../receptions";

interface Line {
  ingredientId: string;
  qty: string;
  lot: string;
  expiry: string;
  temp: string;
}

const blank = (ingredientId: string, qty = ""): Line => ({
  ingredientId,
  qty,
  lot: "",
  expiry: "",
  temp: "",
});
const BIG = "h-16 text-xl md:text-xl";

/**
 * Recepción de mercadería en la tablet de planta (RF-11): por línea la cantidad real, el lote del proveedor,
 * el vencimiento y, en refrigerados, la temperatura (alerta roja por encima de 5 °C). Desde una orden de
 * compra (precarga lo pendiente) o entrega libre de un proveedor. Usa la misma acción y reglas que Compras.
 */
export function PlantReception({ data, supplierId }: { data: ReceptionFormData; supplierId: string }) {
  const router = useRouter();
  const { order } = data;
  const byId = new Map(data.ingredients.map((i) => [i.id, i]));
  const [lines, setLines] = useState<Line[]>(() => {
    if (order) return order.lines.map((l) => blank(l.ingredientId, String(l.pending).replace(".", ",")));
    return data.ingredients.filter((i) => i.supplierIds.includes(supplierId)).map((i) => blank(i.id));
  });
  const [deliveryNote, setDeliveryNote] = useState("");
  const [done, setDone] = useState<{
    lots: number;
    alerts: { ingredient: string; temperatureC: number }[];
  } | null>(null);
  const supplier = data.suppliers.find((s) => s.id === supplierId);

  const create = useAction(createReceptionAction, {
    onSuccess: (r) => setDone({ lots: r.lots, alerts: r.alerts }),
  });
  const set = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const err = (i: number, field: string) => create.fieldErrors[`lines.${i}.${field}`]?.[0];

  const used = new Set(lines.map((l) => l.ingredientId));
  const addable = data.ingredients.filter((i) => !used.has(i.id));
  const filled = lines.filter((l) => (parseDecimalAR(l.qty) ?? 0) > 0).length;

  function submit() {
    create.run({
      supplierId,
      purchaseOrderId: order?.id ?? null,
      deliveryNote,
      notes: "",
      lines: lines.map((l) => {
        const ing = byId.get(l.ingredientId);
        return {
          ingredientId: l.ingredientId,
          qty: l.qty.trim() === "" ? "0" : l.qty,
          supplierLotCode: l.lot,
          expiryDate: l.expiry,
          temperatureC: l.temp,
          locationId: ing?.refrigerated ? data.fridgeId : data.dryId,
        };
      }),
    });
  }

  if (done)
    return (
      <div className="grid gap-4" data-testid="reception-done">
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border-2 border-emerald-600 bg-emerald-50 p-5 text-2xl font-semibold text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          <CheckCircle2 className="size-10 shrink-0" />
          Recepción registrada: {done.lots} {done.lots === 1 ? "lote ingresado" : "lotes ingresados"} al stock
        </div>
        {done.alerts.map((a) => (
          <div
            key={a.ingredient}
            role="alert"
            className="bg-destructive/10 border-destructive text-destructive flex items-center gap-3 rounded-xl border-2 p-5 text-xl font-semibold"
          >
            <AlertTriangle className="size-9 shrink-0" />
            {a.ingredient} llegó a {formatNumber(a.temperatureC, 1)} °C (máximo {MAX_REFRIGERATED_TEMP_C} °C).
            Avisá a la jefa de producción.
          </div>
        ))}
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" className="h-16 text-xl">
            <Link href="/planta/recepcion">Recibir otra entrega</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-16 text-xl">
            <Link href="/planta">Volver al inicio</Link>
          </Button>
        </div>
      </div>
    );

  return (
    <div className="grid gap-5">
      <div className="bg-card rounded-xl border p-4 text-xl">
        <p className="font-semibold">
          {order ? `Orden ${order.number} · ` : "Entrega sin orden · "}
          {supplier?.name ?? "Proveedor"}
        </p>
        <p className="text-muted-foreground text-lg">
          Cargá lo que llegó de cada insumo. Dejá la cantidad vacía (o en 0) de lo que no vino.
        </p>
      </div>

      <ul className="grid gap-4" aria-label="Mercadería recibida">
        {lines.map((l, i) => {
          const ing = byId.get(l.ingredientId);
          if (!ing) return null;
          const pending = order?.lines.find((x) => x.ingredientId === ing.id)?.pending;
          const temp = l.temp.trim() === "" ? null : parseDecimalAR(l.temp);
          const hot = ing.refrigerated && temp != null && isTemperatureAlert(temp);
          const unit = UNIT[ing.unit];
          return (
            <li
              key={ing.id}
              className="bg-card grid gap-3 rounded-xl border p-4"
              data-testid="reception-line"
            >
              <p className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
                {ing.name}
                {ing.refrigerated ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-2 py-0.5 text-base font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-200">
                    <Snowflake className="size-4" /> Refrigerado
                  </span>
                ) : null}
                {pending != null ? (
                  <span className="text-muted-foreground text-lg font-normal">
                    Pendiente: {formatNumber(pending, 3)} {unit}
                  </span>
                ) : null}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={`pq-${i}`} className="text-lg">
                    Cantidad recibida ({unit}) — {ing.name}
                  </Label>
                  <Input
                    id={`pq-${i}`}
                    inputMode="decimal"
                    className={BIG}
                    value={l.qty}
                    onChange={(e) => set(i, { qty: e.target.value })}
                    aria-invalid={!!err(i, "qty")}
                  />
                  {err(i, "qty") ? <p className="text-destructive text-lg">{err(i, "qty")}</p> : null}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`pl-${i}`} className="text-lg">
                    Lote del proveedor — {ing.name}
                  </Label>
                  <Input
                    id={`pl-${i}`}
                    className={BIG}
                    value={l.lot}
                    onChange={(e) => set(i, { lot: e.target.value })}
                    aria-invalid={!!err(i, "supplierLotCode")}
                  />
                  {err(i, "supplierLotCode") ? (
                    <p className="text-destructive text-lg">{err(i, "supplierLotCode")}</p>
                  ) : null}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`pe-${i}`} className="text-lg">
                    Vencimiento — {ing.name}
                  </Label>
                  <Input
                    id={`pe-${i}`}
                    type="date"
                    className={BIG}
                    value={l.expiry}
                    onChange={(e) => set(i, { expiry: e.target.value })}
                    aria-invalid={!!err(i, "expiryDate")}
                  />
                  {err(i, "expiryDate") ? (
                    <p className="text-destructive text-lg">{err(i, "expiryDate")}</p>
                  ) : null}
                </div>
                {ing.refrigerated ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`pt-${i}`} className="text-lg">
                      Temperatura °C — {ing.name}
                    </Label>
                    <Input
                      id={`pt-${i}`}
                      inputMode="decimal"
                      placeholder="Ej.: 4"
                      className={BIG}
                      value={l.temp}
                      onChange={(e) => set(i, { temp: e.target.value })}
                      aria-invalid={!!err(i, "temperatureC") || hot}
                    />
                    {err(i, "temperatureC") ? (
                      <p className="text-destructive text-lg">{err(i, "temperatureC")}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {hot ? (
                <p
                  role="alert"
                  className="bg-destructive/10 border-destructive text-destructive flex items-center gap-2 rounded-lg border-2 p-3 text-xl font-semibold"
                >
                  <AlertTriangle className="size-7 shrink-0" /> Temperatura fuera de rango: supera los{" "}
                  {MAX_REFRIGERATED_TEMP_C} °C. Se registra igual y avisá a la jefa.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {!order && addable.length ? (
        <div className="grid gap-1.5">
          <Label htmlFor="add-ingredient" className="text-lg">
            Agregar otro insumo
          </Label>
          <NativeSelect
            id="add-ingredient"
            className="h-16 text-xl"
            value=""
            onChange={(e) => {
              if (e.target.value) setLines((ls) => [...ls, blank(e.target.value)]);
            }}
          >
            <option value="">Elegí el insumo…</option>
            {addable.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      <div className="grid gap-1.5">
        <Label htmlFor="delivery-note" className="text-lg">
          Remito del proveedor (opcional)
        </Label>
        <Input
          id="delivery-note"
          className={BIG}
          value={deliveryNote}
          onChange={(e) => setDeliveryNote(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button size="lg" className="h-16 text-xl" disabled={create.pending || filled === 0} onClick={submit}>
          Registrar recepción{filled ? ` (${filled})` : ""}
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="h-16 text-xl"
          onClick={() => router.push("/planta/recepcion")}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
