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
}: {
  dispatchId: string;
  dispatchLabel: string;
  customerName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const pad = useRef<SignaturePadHandle>(null);
  const act = useAction(deliverDispatchAction, {
    success: "Entrega registrada",
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
            disabled={busy || act.pending || name.trim().length < 2}
            onClick={submit}
          >
            Confirmar entrega
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
