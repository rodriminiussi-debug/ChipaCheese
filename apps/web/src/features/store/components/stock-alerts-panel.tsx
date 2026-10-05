"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Truck } from "lucide-react";
import { addDays } from "@chipa/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/app/status-badge";
import { useAction } from "@/hooks/use-action";
import { requestReplenishmentAction } from "../actions";
import { STORE_STATUS } from "../labels";
import type { StoreStockAlerts } from "../alerts";

const fmt = (n: number, d = 1) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: d }).format(n);

function when(r: StoreStockAlerts["rows"][number]) {
  if (r.status === "out") return "Agotado";
  if (r.daysLeft == null) return "";
  if (r.daysLeft < 1) return "Se agota hoy";
  return `Alcanza ${fmt(r.daysLeft)} ${r.daysLeft === 1 ? "día" : "días"}`;
}

/**
 * Alertas automáticas del stock del local según la demanda (venta diaria promedio de los últimos 30 días):
 * qué se agota, cuándo y cuánto pedir. Desde acá se arma el pedido de reposición a la planta con las
 * cantidades sugeridas (editables) y la fecha en que se necesita.
 */
export function StockAlertsPanel({ alerts, canRequest }: { alerts: StoreStockAlerts; canRequest: boolean }) {
  const router = useRouter();
  const urgent = alerts.rows.filter((r) => r.status === "out" || r.status === "reorder");
  const requestable = urgent.filter((r) => r.fromPlant && r.suggestedQty > 0);
  const [qty, setQty] = useState<Record<string, string>>({});
  const qtyOf = (r: { productId: string; suggestedQty: number }) =>
    qty[r.productId] ?? String(r.suggestedQty);
  const [skip, setSkip] = useState<Record<string, boolean>>({});
  const [neededBy, setNeededBy] = useState(() => addDays(alerts.today, alerts.leadDays));
  const act = useAction(requestReplenishmentAction, {
    success: (r) => `Pedido de reposición #${r.number} enviado a la planta`,
    onSuccess: () => router.refresh(),
  });

  const chosen = requestable
    .filter((r) => !skip[r.productId])
    .map((r) => ({ productId: r.productId, qty: Math.floor(Number(qtyOf(r))) }))
    .filter((i) => i.qty > 0);

  return (
    <section
      aria-label="Alertas de stock del local"
      className="bg-card mb-6 grid gap-3 rounded-xl border p-4"
      data-testid="store-alerts"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          {urgent.length > 0 ? (
            <AlertTriangle className="size-5 text-amber-600" />
          ) : (
            <CheckCircle2 className="size-5 text-emerald-600" />
          )}
          Qué se está por agotar
        </h2>
        <p className="text-muted-foreground text-xs">
          Venta diaria promedio de los últimos {alerts.observedDays || 30} días · cubrir {alerts.targetDays}{" "}
          días · reposición en {alerts.leadDays} día{alerts.leadDays === 1 ? "" : "s"}
        </p>
      </div>

      {alerts.observedDays === 0 ? (
        <p className="text-muted-foreground text-sm">
          Todavía no hay ventas para medir la demanda. Las alertas aparecen solas apenas se vende.
        </p>
      ) : urgent.length === 0 ? (
        <p className="text-sm">Todo en orden: el stock del local alcanza para lo que se vende.</p>
      ) : (
        <ul className="divide-y" aria-label="Productos a reponer">
          {urgent.map((r) => {
            const canPick = canRequest && r.fromPlant && r.suggestedQty > 0;
            const st = STORE_STATUS[r.status];
            return (
              <li key={r.productId} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="flex items-start gap-3">
                  {canPick ? (
                    <input
                      type="checkbox"
                      className="mt-1 size-5"
                      aria-label={`Incluir ${r.name} en el pedido`}
                      checked={!skip[r.productId]}
                      onChange={(e) => setSkip((s) => ({ ...s, [r.productId]: !e.target.checked }))}
                    />
                  ) : null}
                  <div className="grid gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.name}</span>
                      <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                      {r.runsOutBeforeArrival && r.status !== "out" ? (
                        <StatusBadge tone="bad">Se agota antes de que llegue</StatusBadge>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground text-sm">
                      {when(r)} · {fmt(r.stock)} en el local · se vende {fmt(r.avgDaily)} por día
                      {r.includesPrepared ? " (incluye elaborados)" : ""}
                    </p>
                    {r.incoming > 0 ? (
                      <p className="text-sm text-sky-700 dark:text-sky-300">
                        Ya pediste {r.incoming} a la planta.
                      </p>
                    ) : null}
                    {!r.fromPlant ? (
                      <p className="text-muted-foreground text-sm">
                        Reventa: se repone con el proveedor (sugerido {r.suggestedQty}). Cargalo en
                        Mercadería.
                      </p>
                    ) : null}
                  </div>
                </div>
                {canPick ? (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Pedir</span>
                    <Input
                      aria-label={`Cantidad a pedir de ${r.name}`}
                      inputMode="numeric"
                      className="h-11 w-24 text-right text-base"
                      value={qtyOf(r)}
                      disabled={!!skip[r.productId]}
                      onChange={(e) => setQty((q) => ({ ...q, [r.productId]: e.target.value }))}
                    />
                    <span className="text-muted-foreground">u.</span>
                  </label>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canRequest && requestable.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3 border-t pt-3">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Se necesita para el</span>
            <Input
              type="date"
              className="h-11 w-44"
              min={alerts.today}
              value={neededBy}
              onChange={(e) => setNeededBy(e.target.value)}
            />
          </label>
          <Button
            type="button"
            size="lg"
            className="h-11"
            disabled={act.pending || chosen.length === 0}
            onClick={() => act.run({ items: chosen, neededBy, notes: null })}
          >
            <Truck /> Pedir reposición
          </Button>
        </div>
      ) : null}
    </section>
  );
}
