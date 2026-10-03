"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import {
  ArrowDown,
  ArrowUp,
  Check,
  FileText,
  MapPin,
  MessageCircle,
  Paperclip,
  Trash2,
  Undo2,
} from "lucide-react";
import { formatDateAR, formatKg } from "@chipa/domain";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { ORDER_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { generateDispatchAction, moveStopAction, removeStopAction, setStopDoneAction } from "../actions";
import { DISPATCH_STATUS, formatDispatchNumber, mapsUrl, proofUrl, whatsappUrl } from "../labels";
import type { StopView } from "../service";
import { DeliverDialog } from "./deliver-dialog";
import { RejectDialog } from "./reject-dialog";

/**
 * Una parada de la ruta, pensada para el celular del chofer: dirección con link a Google Maps,
 * qué se lleva, remito (generar / ver), entrega con conformidad o rechazo, y marcar como hecha.
 * Con `canWrite` la ruta se puede reordenar y quitar paradas mientras está abierta.
 */
export function StopCard({
  stop,
  routeId,
  open,
  canWrite,
  isFirst,
  isLast,
  canViewOrders,
}: {
  stop: StopView;
  routeId: string;
  /** La ruta está planificada o en curso. */
  open: boolean;
  canWrite: boolean;
  isFirst: boolean;
  isLast: boolean;
  canViewOrders: boolean;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const move = useAction(moveStopAction, { onSuccess: refresh });
  const remove = useAction(removeStopAction, { success: "Parada quitada", onSuccess: refresh });
  const done = useAction(setStopDoneAction, { onSuccess: refresh });
  const make = useAction(generateDispatchAction, {
    success: (r) => `Remito ${formatDispatchNumber(r.number)} generado`,
    onSuccess: refresh,
  });

  const isDelivery = stop.kind === "delivery";
  const d = stop.dispatch;
  const live = d && (d.status === "prepared" || d.status === "delivered");
  const orderStatus = stop.orderStatus ? ORDER_STATUS[stop.orderStatus] : null;
  const canMakeDispatch =
    isDelivery &&
    open &&
    canWrite &&
    !live &&
    (stop.orderStatus === "ready" || stop.orderStatus === "dispatched");
  const notReady = isDelivery && !live && stop.orderStatus !== "ready" && stop.orderStatus !== "dispatched";
  const busy = move.pending || remove.pending || done.pending || make.pending;
  const mapsLink = isDelivery
    ? mapsUrl(stop.address ?? stop.title, stop.zoneName, "Argentina")
    : mapsUrl(stop.title, "Argentina");

  return (
    <Card data-testid="stop-card" data-done={stop.done} className={cn(stop.done && "bg-muted/40")}>
      <CardContent className="grid gap-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold",
              stop.done && "border-emerald-600 bg-emerald-600 text-white",
            )}
            aria-hidden
          >
            {stop.done ? <Check className="size-4" /> : stop.seq}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{stop.title}</h3>
              {!isDelivery ? <StatusBadge tone="info">Retiro en proveedor</StatusBadge> : null}
              {stop.done ? <StatusBadge tone="good">Hecha</StatusBadge> : null}
              {d ? (
                <StatusBadge tone={DISPATCH_STATUS[d.status]?.tone}>
                  {DISPATCH_STATUS[d.status]?.label}
                </StatusBadge>
              ) : null}
              {notReady ? (
                <StatusBadge tone="warn">No listo ({orderStatus?.label.toLowerCase()})</StatusBadge>
              ) : null}
            </div>
            <a
              href={mapsLink}
              target="_blank"
              rel="noreferrer"
              className="text-primary mt-1 inline-flex items-start gap-1 text-sm underline-offset-2 hover:underline"
            >
              <MapPin className="mt-0.5 size-4 shrink-0" />
              <span>
                {isDelivery ? (stop.address ?? "Sin dirección cargada") : "Ver ubicación del proveedor"}
                {isDelivery && stop.zoneName ? ` · ${stop.zoneName}` : ""}
              </span>
              <span className="sr-only"> (abre Google Maps)</span>
            </a>
            {stop.whatsapp ? (
              <a
                href={whatsappUrl(stop.whatsapp)}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground ml-3 inline-flex items-center gap-1 text-sm hover:underline"
              >
                <MessageCircle className="size-4" /> WhatsApp
              </a>
            ) : null}
          </div>
          {open && canWrite ? (
            <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
              <Button
                variant="outline"
                size="icon"
                aria-label={`Subir parada ${stop.seq}`}
                disabled={isFirst || busy}
                onClick={() => move.run({ stopId: stop.id, direction: "up" })}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={`Bajar parada ${stop.seq}`}
                disabled={isLast || busy}
                onClick={() => move.run({ stopId: stop.id, direction: "down" })}
              >
                <ArrowDown />
              </Button>
            </div>
          ) : null}
        </div>

        {isDelivery ? (
          <div className="text-sm">
            <p className="text-muted-foreground">
              {canViewOrders && stop.orderId ? (
                <Link href={`/pedidos/${stop.orderId}` as Route} className="font-medium hover:underline">
                  Pedido #{stop.orderNumber}
                </Link>
              ) : (
                <span className="font-medium">Pedido #{stop.orderNumber}</span>
              )}{" "}
              · {formatKg(stop.kg)} · {stop.units} bultos
            </p>
            <ul className="mt-1">
              {stop.lines.map((l) => (
                <li key={l.productName} className="flex justify-between gap-2">
                  <span>{l.productName}</span>
                  <span className="font-semibold tabular-nums">{l.qtyUnits}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {stop.notes ? <p className="bg-muted rounded-md p-2 text-sm">{stop.notes}</p> : null}

        {d ? (
          <div className="text-sm" data-testid="stop-dispatch">
            <p className="font-medium">
              Remito {formatDispatchNumber(d.number)}
              {stop.rejectedCount ? (
                <span className="text-muted-foreground font-normal">
                  {" "}
                  (reentrega #{stop.rejectedCount + 1})
                </span>
              ) : null}
            </p>
            <ul className="text-muted-foreground">
              {d.items.map((i, k) => (
                <li key={k}>
                  {i.qtyUnits} × {i.productName} — lote {i.lotCode} (vence {formatDateAR(i.expiryDate)})
                </li>
              ))}
            </ul>
            {d.status === "delivered" ? (
              <p className="mt-1">
                Recibió <span className="font-medium">{d.receivedByName}</span>
                {d.proofFileKey ? (
                  <>
                    {" · "}
                    <a
                      href={proofUrl(d.proofFileKey)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary inline-flex items-center gap-1 hover:underline"
                    >
                      <Paperclip className="size-3.5" /> Ver conformidad
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
            {d.status === "rejected" && d.notes ? (
              <p className="text-destructive mt-1">Rechazado: {d.notes}</p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {canMakeDispatch ? (
            <Button
              className="h-11 flex-1 text-base sm:flex-none"
              disabled={busy}
              onClick={() => make.run({ routeId, orderId: stop.orderId! })}
            >
              <FileText /> Generar remito
            </Button>
          ) : null}
          {d ? (
            <Button asChild variant="outline" className="h-11 flex-1 text-base sm:flex-none">
              <Link href={`/despacho/remitos/${d.id}`}>
                <FileText /> Ver remito
              </Link>
            </Button>
          ) : null}
          {canWrite && d?.status === "prepared" ? (
            <>
              <DeliverDialog
                dispatchId={d.id}
                dispatchLabel={formatDispatchNumber(d.number)}
                customerName={stop.title}
              />
              <RejectDialog
                dispatchId={d.id}
                dispatchLabel={formatDispatchNumber(d.number)}
                customerName={stop.title}
              />
            </>
          ) : null}
          {canWrite && open && !(d && d.status === "delivered") ? (
            <Button
              variant="outline"
              className="h-11 flex-1 text-base sm:flex-none"
              disabled={busy}
              onClick={() => done.run({ stopId: stop.id, done: !stop.done })}
            >
              {stop.done ? (
                <>
                  <Undo2 /> Deshacer
                </>
              ) : (
                <>
                  <Check /> Marcar hecha
                </>
              )}
            </Button>
          ) : null}
          {canWrite && open && !live ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={`Quitar parada ${stop.seq}`}
              disabled={busy}
              onClick={() => remove.run({ stopId: stop.id })}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
