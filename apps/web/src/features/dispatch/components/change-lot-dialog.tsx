"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Replace } from "lucide-react";
import { formatDateAR } from "@chipa/domain";
import { NativeSelect } from "@/components/app/native-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { changeDispatchLotAction } from "../actions";

export interface LotChoice {
  finishedLotId: string;
  code: string;
  expiryDate: string;
  available: number;
}

/**
 * RF-25: cambio manual del lote que el sistema asignó por FEFO a una línea del remito. El motivo es
 * obligatorio y el servidor valida que el lote elegido tenga stock suficiente.
 */
export function ChangeLotDialog({
  dispatchItemId,
  productName,
  currentLotCode,
  qtyUnits,
  options,
}: {
  dispatchItemId: string;
  productName: string;
  currentLotCode: string;
  qtyUnits: number;
  options: LotChoice[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lotId, setLotId] = useState("");
  const [reason, setReason] = useState("");
  const act = useAction(changeDispatchLotAction, {
    success: (r) => `Lote cambiado: ahora ${r.lotCode}`,
    onSuccess: () => {
      setOpen(false);
      setReason("");
      setLotId("");
      router.refresh();
    },
  });
  const choices = options.filter((o) => o.code !== currentLotCode);
  const reasonErr = act.fieldErrors.reason?.[0];
  const lotErr = act.fieldErrors.finishedLotId?.[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="print:hidden"
          aria-label={`Cambiar el lote de ${productName} (${currentLotCode})`}
        >
          <Replace /> Cambiar lote
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar el lote de {productName}</DialogTitle>
          <DialogDescription>
            Hoy sale del lote {currentLotCode} ({qtyUnits} u.). Elegí otro lote con stock en F3/F4 y contá por
            qué: queda registrado en el remito.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`lot-${dispatchItemId}`}>Lote nuevo</Label>
            <NativeSelect
              id={`lot-${dispatchItemId}`}
              value={lotId}
              onChange={(e) => setLotId(e.target.value)}
              aria-invalid={!!lotErr}
            >
              <option value="">Elegí el lote…</option>
              {choices.map((o) => (
                <option key={o.finishedLotId} value={o.finishedLotId}>
                  {o.code} · vence {formatDateAR(o.expiryDate)} · {o.available} u. disponibles
                </option>
              ))}
            </NativeSelect>
            {lotErr ? <p className="text-destructive text-sm">{lotErr}</p> : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`reason-${dispatchItemId}`}>Motivo del cambio</Label>
            <Textarea
              id={`reason-${dispatchItemId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              aria-invalid={!!reasonErr}
            />
            {reasonErr ? <p className="text-destructive text-sm">{reasonErr}</p> : null}
          </div>
          <Button
            disabled={act.pending || !lotId || reason.trim().length < 3}
            onClick={() => act.run({ dispatchItemId, finishedLotId: lotId, reason: reason.trim() })}
          >
            Confirmar cambio de lote
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
