"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PackageX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { rejectDispatchAction } from "../actions";

/** RF-25: rechazo total en la puerta del cliente. El stock vuelve al lote (F3). */
export function RejectDialog({
  dispatchId,
  dispatchLabel,
  customerName,
}: {
  dispatchId: string;
  dispatchLabel: string;
  customerName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [who, setWho] = useState("");
  const act = useAction(rejectDispatchAction, {
    success: "Rechazo registrado: el stock volvió al lote",
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });
  const err = act.fieldErrors.reason?.[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-11 flex-1 text-base sm:flex-none">
          <PackageX /> Rechazar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rechazo — {customerName}</DialogTitle>
          <DialogDescription>
            Remito {dispatchLabel}. Se devuelve todo el stock al mismo lote en el freezer F3.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`rej-reason-${dispatchId}`}>Motivo del rechazo</Label>
            <Textarea
              id={`rej-reason-${dispatchId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              aria-invalid={!!err}
            />
            {err ? <p className="text-destructive text-sm">{err}</p> : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`rej-who-${dispatchId}`}>Quién lo rechazó (opcional)</Label>
            <Input id={`rej-who-${dispatchId}`} value={who} onChange={(e) => setWho(e.target.value)} />
          </div>
          <Button
            variant="destructive"
            size="lg"
            className="h-12 text-base"
            disabled={act.pending || reason.trim().length < 3}
            onClick={() => act.run({ dispatchId, reason, receivedByName: who || null })}
          >
            Confirmar rechazo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
