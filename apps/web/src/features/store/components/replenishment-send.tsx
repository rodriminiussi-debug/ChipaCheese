"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText } from "@/components/app/format";
import { useAction } from "@/hooks/use-action";
import { formatDateTimeAR } from "@/lib/dates";
import { cancelReplenishmentAction, sendReplenishmentAction } from "../actions";
import type { ReplenishmentRow } from "../replenishment";

/**
 * Pedidos de reposición del local que la planta tiene que enviar. Al enviar se transfiere F3/F4 → LOCAL por
 * FEFO la cantidad indicada (por defecto, lo pedido; se puede enviar menos si no alcanza el stock).
 */
export function ReplenishmentSend({
  rep,
  plantStock,
  today,
}: {
  rep: ReplenishmentRow;
  /** Unidades disponibles en F3 + F4 por producto. */
  plantStock: Record<string, number>;
  today: string;
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(rep.items.map((i) => [i.id, String(Math.min(i.qtyRequested, plantStock[i.productId] ?? 0))])),
  );
  const send = useAction(sendReplenishmentAction, {
    success: (r) => `Pedido #${r.number} enviado: ${r.sentUnits} unidades pasaron al local`,
    onSuccess: () => router.refresh(),
  });
  const cancel = useAction(cancelReplenishmentAction, {
    success: (r) => `Pedido #${r.number} cancelado`,
    onSuccess: () => router.refresh(),
  });
  const overdue = rep.neededBy != null && rep.neededBy < today;
  const total = rep.items.reduce((a, i) => a + (Number(qty[i.id]) || 0), 0);

  return (
    <article className="bg-card grid gap-3 rounded-xl border p-4" aria-label={`Pedido de reposición ${rep.number}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">Pedido #{rep.number}</h3>
          {overdue ? <StatusBadge tone="bad">Vencido</StatusBadge> : <StatusBadge tone="warn">Pedido</StatusBadge>}
        </div>
        <span className="text-muted-foreground text-sm">
          {formatDateTimeAR(rep.requestedAt)}
          {rep.requestedBy ? ` · ${rep.requestedBy.name}` : ""}
          {rep.neededBy ? (
            <>
              {" "}
              · se necesita para el <DateText value={rep.neededBy} />
            </>
          ) : null}
        </span>
      </div>
      {rep.notes ? <p className="text-sm">{rep.notes}</p> : null}
      <ul className="grid gap-2">
        {rep.items.map((i) => {
          const have = plantStock[i.productId] ?? 0;
          const n = Number(qty[i.id]) || 0;
          return (
            <li key={i.id} className="grid gap-1 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <span className="font-medium">{i.product.name}</span>
                <span className="text-muted-foreground block text-sm">
                  Pidió {i.qtyRequested} · en F3 + F4 hay {have}
                </span>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Enviar</span>
                <Input
                  aria-label={`Unidades a enviar de ${i.product.name} (pedido ${rep.number})`}
                  inputMode="numeric"
                  className="h-11 w-24 text-right text-base"
                  value={qty[i.id] ?? ""}
                  aria-invalid={n > have}
                  onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.value }))}
                />
                <span className="text-muted-foreground">u.</span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={send.pending || total <= 0}
          aria-label={`Enviar el pedido ${rep.number} al local`}
          onClick={() =>
            send.run({
              id: rep.id,
              items: rep.items.map((i) => ({ itemId: i.id, qty: Math.max(0, Math.floor(Number(qty[i.id]) || 0)) })),
            })
          }
        >
          <Truck /> Enviar al local
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={cancel.pending}
          aria-label={`Cancelar el pedido ${rep.number}`}
          onClick={() => cancel.run({ id: rep.id })}
        >
          Cancelar pedido
        </Button>
      </div>
    </article>
  );
}
