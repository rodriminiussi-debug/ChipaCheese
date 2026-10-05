"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { voidStoreSaleAction } from "../actions";

/** Anular una venta cargada por error: pide el motivo, devuelve el stock y deja la venta marcada. */
export function VoidSaleButton({ saleId, summary }: { saleId: string; summary: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const act = useAction(voidStoreSaleAction, {
    success: (r) =>
      `Venta anulada: ${r.returnedUnits === 1 ? "volvió 1 unidad" : `volvieron ${String(r.returnedUnits).replace(".", ",")} unidades`} al stock`,
    onSuccess: () => {
      setOpen(false);
      setReason("");
      router.refresh();
    },
  });
  const tooShort = reason.trim().length < 3;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={`Anular la venta de ${summary}`}>
          <Ban /> Anular
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Anular venta</DialogTitle>
          <DialogDescription>
            {summary}. El stock vuelve al local y la venta deja de contar en la caja y en los totales. Queda
            registrada como anulada.
          </DialogDescription>
        </DialogHeader>
        <Field data-invalid={act.result?.ok === false && tooShort}>
          <FieldLabel htmlFor={`void-reason-${saleId}`}>Motivo de la anulación</FieldLabel>
          <Textarea
            id={`void-reason-${saleId}`}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej.: cargué mal la cantidad"
          />
          <FieldError>{act.fieldErrors.reason?.[0]}</FieldError>
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={act.pending || tooShort}
            onClick={() => act.run({ saleId, reason })}
          >
            Anular la venta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
