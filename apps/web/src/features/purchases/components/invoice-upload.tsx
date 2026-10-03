"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, FileText, FileUp, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { createManualInvoiceAction, uploadInvoiceAction } from "../actions";

const MAX_SIDE = 2000;
const COMPRESS_OVER = 1.5 * 1024 * 1024;

/** Reduce fotos pesadas del celular (a JPEG de hasta 2000 px) antes de subirlas. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= COMPRESS_OVER || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // formato que el navegador no decodifica: se sube tal cual
  }
}

/**
 * RF-08: subir la foto (cámara del celular) o el PDF de la factura. La IA la lee y deja un
 * borrador para revisar; también se puede cargar a mano sin foto.
 */
export function InvoiceUpload() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  const upload = useAction(uploadInvoiceAction, {
    onSuccess: ({ id, warning }) => {
      if (warning) toast.warning(warning, { duration: 10000 });
      else toast.success("Factura leída: revisá los datos y confirmá");
      router.push(`/compras/facturas/${id}`);
    },
  });
  const manual = useAction(createManualInvoiceAction, {
    onSuccess: ({ id }) => router.push(`/compras/facturas/${id}`),
  });

  async function onPick(f: File | undefined) {
    if (!f) return;
    setPreparing(true);
    const ready = await shrink(f);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return ready.type.startsWith("image/") ? URL.createObjectURL(ready) : null;
    });
    setFile(ready);
    setPreparing(false);
  }

  const busy = upload.pending || manual.pending;
  const fieldError = upload.fieldErrors.file?.[0];

  return (
    <div className="grid max-w-2xl gap-6">
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Con `capture` el celular abre la cámara trasera directamente. */}
        <label className="border-input hover:bg-accent focus-within:ring-ring/50 flex h-20 cursor-pointer items-center justify-center gap-2 rounded-lg border text-base font-medium focus-within:ring-[3px]">
          <Camera className="size-5" />
          Sacar foto
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label="Sacar foto de la factura"
            onChange={(e) => onPick(e.target.files?.[0])}
            disabled={busy}
          />
        </label>
        <label className="border-input hover:bg-accent focus-within:ring-ring/50 flex h-20 cursor-pointer items-center justify-center gap-2 rounded-lg border text-base font-medium focus-within:ring-[3px]">
          <FileUp className="size-5" />
          Elegir foto o PDF
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="sr-only"
            aria-label="Elegir foto o PDF de la factura"
            onChange={(e) => onPick(e.target.files?.[0])}
            disabled={busy}
          />
        </label>
      </div>

      {file ? (
        <div className="grid gap-3 rounded-lg border p-3">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:)
            <img
              src={preview}
              alt="Vista previa de la factura"
              className="max-h-80 rounded-md object-contain"
            />
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <FileText className="size-5" /> {file.name}
            </div>
          )}
          <div className="text-muted-foreground text-xs">
            {file.name} · {(file.size / 1024).toFixed(0)} KB
          </div>
          {fieldError ? <p className="text-destructive text-sm">{fieldError}</p> : null}
          <Button
            size="lg"
            disabled={busy || preparing}
            onClick={() => {
              const fd = new FormData();
              fd.set("file", file);
              upload.run(fd);
            }}
          >
            {upload.pending ? <Spinner /> : null}
            {upload.pending ? "Leyendo la factura…" : "Leer factura con IA"}
          </Button>
        </div>
      ) : null}

      <div className="text-muted-foreground flex items-center gap-3 text-sm">
        <span className="bg-border h-px flex-1" /> o <span className="bg-border h-px flex-1" />
      </div>
      <div>
        <Button variant="outline" disabled={busy} onClick={() => manual.run({})}>
          <PencilLine /> Cargar a mano (sin foto)
        </Button>
      </div>
    </div>
  );
}
