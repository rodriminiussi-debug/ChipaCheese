"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText } from "@/components/app/format";
import { useAction } from "@/hooks/use-action";
import { formatDateTimeAR } from "@/lib/dates";
import { cancelReplenishmentAction, receiveReplenishmentAction } from "../actions";
import { REPLENISHMENT_STATUS } from "../labels";
import type { ReplenishmentRow } from "../replenishment";

/** Pedidos de reposición del local: estado, ítems y las acciones del local (confirmar recepción, cancelar). */
export function ReplenishmentList({
  rows,
  canAct,
  empty = "Todavía no pediste reposición. Desde las alertas de arriba podés pedirle producto a la planta.",
}: {
  rows: ReplenishmentRow[];
  canAct: boolean;
  empty?: string;
}) {
  const router = useRouter();
  const receive = useAction(receiveReplenishmentAction, {
    success: (r) => `Pedido #${r.number} recibido`,
    onSuccess: () => router.refresh(),
  });
  const cancel = useAction(cancelReplenishmentAction, {
    success: (r) => `Pedido #${r.number} cancelado`,
    onSuccess: () => router.refresh(),
  });

  if (rows.length === 0)
    return <p className="text-muted-foreground text-sm">{empty}</p>;
  return (
    <ul className="grid gap-3" aria-label="Pedidos de reposición">
      {rows.map((r) => {
        const st = REPLENISHMENT_STATUS[r.status]!;
        return (
          <li key={r.id} className="bg-card grid gap-2 rounded-xl border p-4" data-status={r.status}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Pedido #{r.number}</span>
                <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
              </div>
              <span className="text-muted-foreground text-sm">
                Pedido {formatDateTimeAR(r.requestedAt)}
                {r.requestedBy ? ` por ${r.requestedBy.name}` : ""}
              </span>
            </div>
            <ul className="text-sm">
              {r.items.map((i) => (
                <li key={i.id}>
                  {r.status === "requested" || i.qtySent == null ? i.qtyRequested : i.qtySent} × {i.product.name}
                  {i.qtySent != null && i.qtySent !== i.qtyRequested ? (
                    <span className="text-muted-foreground"> (pedidas {i.qtyRequested})</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="text-muted-foreground flex flex-wrap gap-x-4 text-sm">
              {r.neededBy ? (
                <span>
                  Se necesita para el <DateText value={r.neededBy} />
                </span>
              ) : null}
              {r.sentAt ? (
                <span>
                  Enviada {formatDateTimeAR(r.sentAt)}
                  {r.sentBy ? ` por ${r.sentBy.name}` : ""}
                </span>
              ) : null}
              {r.receivedAt ? <span>Recibida {formatDateTimeAR(r.receivedAt)}</span> : null}
              {r.notes ? <span>{r.notes}</span> : null}
            </div>
            {canAct && r.status === "sent" ? (
              <div>
                <Button
                  type="button"
                  disabled={receive.pending}
                  onClick={() => receive.run({ id: r.id })}
                  aria-label={`Confirmar recepción del pedido ${r.number}`}
                >
                  Confirmar recepción
                </Button>
              </div>
            ) : null}
            {canAct && r.status === "requested" ? (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={cancel.pending}
                  onClick={() => cancel.run({ id: r.id })}
                  aria-label={`Cancelar el pedido ${r.number}`}
                >
                  Cancelar pedido
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
