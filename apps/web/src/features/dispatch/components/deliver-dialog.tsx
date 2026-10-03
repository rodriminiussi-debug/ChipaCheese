"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, PackageCheck } from "lucide-react";
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
import { useAction } from "@/hooks/use-action";
import { deliverDispatchAction } from "../actions";
import { SignaturePad, type SignaturePadHandle } from "./signature-pad";

/** Achica la foto del celular (lado mayor 1600 px, JPEG) para que suba rápido con poca señal. */
async function shrinkImage(file: File, maxSide = 1600): Promise<File> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.82));
    return blob ? new File([blob], "conformidad.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

/**
 * RF-25: entrega con conformidad. Nombre de quien recibe (obligatorio) y, opcionalmente, foto del
 * remito firmado (cámara del celular) o firma dibujada en pantalla.
 */
export function DeliverDialog({
  dispatchId,
  dispatchLabel,
  customerName,
  items = [],
}: {
  dispatchId: string;
  dispatchLabel: string;
  customerName: string;
  /** Líneas del remito: permiten registrar una entrega parcial con la cantidad real entregada. */
  items?: { id: string; productName: string; lotCode: string; qtyUnits: number }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [delivered, setDelivered] = useState<Record<string, string>>({});
  const pad = useRef<SignaturePadHandle>(null);
  const qtyOf = (i: { id: string; qtyUnits: number }) => {
    const raw = delivered[i.id];
    return raw === undefined || raw === "" ? i.qtyUnits : Number(raw);
  };
  const invalid = items.some((i) => !Number.isInteger(qtyOf(i)) || qtyOf(i) < 0 || qtyOf(i) > i.qtyUnits);
  const returned = items.reduce((a, i) => a + (Number.isInteger(qtyOf(i)) ? i.qtyUnits - qtyOf(i) : 0), 0);
  const totalDelivered = items.reduce((a, i) => a + qtyOf(i), 0);
  const act = useAction(deliverDispatchAction, {
    success: (r) =>
      r.partial ? `Entrega parcial registrada: ${r.returnedUnits} u. vuelven al stock` : "Entrega registrada",
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });

  async function submit() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("dispatchId", dispatchId);
      fd.set("receivedByName", name);
      const changed = items
        .filter((i) => qtyOf(i) !== i.qtyUnits)
        .map((i) => ({ dispatchItemId: i.id, qty: qtyOf(i) }));
      if (changed.length) fd.set("quantities", JSON.stringify(changed));
      const signature = await pad.current?.toFile();
      const proof = signature ?? (photo ? await shrinkImage(photo) : null);
      if (proof) fd.set("proof", proof);
      await act.run(fd);
    } finally {
      setBusy(false);
    }
  }

  const err = act.fieldErrors.receivedByName?.[0];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-11 flex-1 text-base sm:flex-none">
          <PackageCheck /> Entregar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Entrega — {customerName}</DialogTitle>
          <DialogDescription>
            Remito {dispatchLabel}. Anotá quién recibe y, si podés, sacá una foto del remito firmado o hacé
            firmar en pantalla.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`recv-${dispatchId}`}>Recibió (nombre y apellido)</Label>
            <Input
              id={`recv-${dispatchId}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              className="h-11 text-base"
              aria-invalid={!!err}
            />
            {err ? <p className="text-destructive text-sm">{err}</p> : null}
          </div>
          {items.length ? (
            <fieldset className="grid gap-2 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">Cantidad entregada</legend>
              {items.map((i) => (
                <div key={i.id} className="grid grid-cols-[1fr_5.5rem] items-center gap-2 text-sm">
                  <Label htmlFor={`qty-${i.id}`} className="font-normal">
                    {i.productName} · lote {i.lotCode}{" "}
                    <span className="text-muted-foreground">(remito: {i.qtyUnits} u.)</span>
                  </Label>
                  <Input
                    id={`qty-${i.id}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={i.qtyUnits}
                    className="h-11 text-right text-base"
                    value={delivered[i.id] ?? String(i.qtyUnits)}
                    onChange={(e) => setDelivered((prev) => ({ ...prev, [i.id]: e.target.value }))}
                    aria-label={`Entregado de ${i.productName} lote ${i.lotCode}`}
                  />
                </div>
              ))}
              {returned > 0 && !invalid ? (
                <p className="text-sm text-amber-700 dark:text-amber-400" role="status">
                  Entrega parcial: {returned} u. no se entregan y vuelven al stock del lote.
                </p>
              ) : null}
              {invalid ? (
                <p className="text-destructive text-sm" role="alert">
                  Cada cantidad tiene que ser un entero entre 0 y lo que dice el remito.
                </p>
              ) : null}
              {totalDelivered === 0 && !invalid ? (
                <p className="text-destructive text-sm" role="alert">
                  Si no se entregó nada, rechazá el remito.
                </p>
              ) : null}
            </fieldset>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor={`photo-${dispatchId}`} className="flex items-center gap-1.5">
              <Camera className="size-4" /> Foto de la conformidad
            </Label>
            <Input
              id={`photo-${dispatchId}`}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            />
          </div>
          <SignaturePad padRef={pad} label="O firma en pantalla" />
          <Button
            size="lg"
            className="h-12 text-base"
            disabled={
              busy ||
              act.pending ||
              name.trim().length < 2 ||
              invalid ||
              (items.length > 0 && totalDelivered === 0)
            }
            onClick={submit}
          >
            Confirmar entrega
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
