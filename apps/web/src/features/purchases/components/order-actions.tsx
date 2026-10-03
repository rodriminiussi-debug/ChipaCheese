"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle, PackageCheck, Pencil, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { changeOrderStatusAction } from "../actions";

type Status = "draft" | "sent" | "partially_received" | "received" | "cancelled";

/** Acciones de una OC según su estado (RF-10): enviar por WhatsApp, cancelar, recibir. */
export function OrderActions({
  orderId,
  status,
  whatsappUrl,
}: {
  orderId: string;
  status: Status;
  /** `https://wa.me/<numero>?text=<detalle>`; null si el proveedor no tiene WhatsApp. */
  whatsappUrl: string | null;
}) {
  const router = useRouter();
  const change = useAction(changeOrderStatusAction, {
    success: (r) => (r.status === "sent" ? "Orden marcada como enviada" : "Orden cancelada"),
    onSuccess: () => router.refresh(),
  });
  const canSend = status === "draft" || status === "sent" || status === "partially_received";

  return (
    <div className="flex flex-wrap gap-2">
      {canSend ? (
        whatsappUrl ? (
          <Button asChild>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noreferrer"
              // Abrir el link es el envío: la orden pasa a "enviada" si estaba en borrador.
              onClick={() => {
                if (status === "draft") change.run({ id: orderId, status: "sent" });
              }}
            >
              <MessageCircle /> Enviar por WhatsApp
            </a>
          </Button>
        ) : (
          <Button disabled title="El proveedor no tiene un WhatsApp válido cargado">
            <MessageCircle /> Enviar por WhatsApp
          </Button>
        )
      ) : null}
      {status === "draft" ? (
        <>
          <Button variant="outline" asChild>
            <Link href={`/compras/ordenes/${orderId}/editar`}>
              <Pencil /> Editar
            </Link>
          </Button>
          <Button
            variant="outline"
            disabled={change.pending}
            onClick={() => change.run({ id: orderId, status: "sent" })}
          >
            <Send /> Marcar como enviada
          </Button>
        </>
      ) : null}
      {status === "sent" || status === "partially_received" ? (
        <Button variant="outline" asChild>
          <Link href={`/compras/recepciones/nueva?orden=${orderId}`}>
            <PackageCheck /> Recibir mercadería
          </Link>
        </Button>
      ) : null}
      {status === "draft" || status === "sent" ? (
        <Button
          variant="ghost"
          className="text-destructive"
          disabled={change.pending}
          onClick={() => {
            if (window.confirm("¿Cancelar esta orden de compra?"))
              change.run({ id: orderId, status: "cancelled" });
          }}
        >
          <XCircle /> Cancelar orden
        </Button>
      ) : null}
    </div>
  );
}
