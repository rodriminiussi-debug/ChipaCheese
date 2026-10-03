"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import type { OrderStatus } from "@chipa/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAction } from "@/hooks/use-action";
import { ORDER_STATUS } from "@/lib/labels";
import { transitionOrderAction } from "../actions";
import { TRANSITION_LABEL } from "../labels";

/**
 * RF-03: botones de transición. `next` viene del dominio (`nextStatuses`) y el servidor lo revalida.
 * El primer estado es el paso natural; los demás (saltos) van en el menú; cancelar pide confirmación.
 */
export function StatusActions({ orderId, next }: { orderId: string; next: OrderStatus[] }) {
  const router = useRouter();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [note, setNote] = useState("");
  const move = useAction(transitionOrderAction, {
    success: (r) => `Pedido ${ORDER_STATUS[r.to]?.label.toLowerCase()}`,
    onSuccess: () => router.refresh(),
  });

  const forward = next.filter((s) => s !== "cancelled");
  const canCancel = next.includes("cancelled");
  const [primary, ...others] = forward;
  if (!primary && !canCancel) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {primary ? (
        <Button
          size="lg"
          className="h-11 px-5 text-base"
          disabled={move.pending}
          onClick={() => move.run({ id: orderId, to: primary })}
        >
          {TRANSITION_LABEL[primary]}
        </Button>
      ) : null}
      {others.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="lg" className="h-11" disabled={move.pending}>
              Saltar a… <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Pasar directo a</DropdownMenuLabel>
            {others.map((s) => (
              <DropdownMenuItem key={s} onSelect={() => move.run({ id: orderId, to: s })}>
                {ORDER_STATUS[s]?.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {canCancel ? (
        <Button variant="destructive" size="lg" className="h-11" onClick={() => setConfirmCancel(true)}>
          Cancelar pedido
        </Button>
      ) : null}

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar el pedido?</AlertDialogTitle>
            <AlertDialogDescription>
              Queda registrado en el historial con el motivo y ya no se puede reabrir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            aria-label="Motivo de la cancelación"
            aria-required
            placeholder="Motivo (obligatorio)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {move.fieldErrors.note?.[0] ? (
            <p className="text-destructive text-sm" role="alert">
              {move.fieldErrors.note[0]}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              disabled={!note.trim() || move.pending}
              onClick={() => move.run({ id: orderId, to: "cancelled", note: note.trim() })}
            >
              Sí, cancelar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
