import { ExternalLink } from "lucide-react";

/** Foto o PDF de la factura, para mirarla al lado del formulario. `url` viene de `fileUrl(key)`. */
export function InvoiceFile({ url, name }: { url: string; name: string }) {
  const isPdf = name.toLowerCase().endsWith(".pdf");
  return (
    <div className="grid gap-2">
      {isPdf ? (
        <iframe src={url} title="Factura (PDF)" className="h-[70vh] w-full rounded-lg border" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- archivo privado servido por /api/files
        <img
          src={url}
          alt="Foto de la factura"
          className="max-h-[75vh] w-full rounded-lg border object-contain"
        />
      )}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ExternalLink className="size-4" /> Abrir en una pestaña nueva
      </a>
    </div>
  );
}
