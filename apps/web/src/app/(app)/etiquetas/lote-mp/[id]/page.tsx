import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { ArrowLeft } from "lucide-react";
import { rawLotQrPayload } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { NativeSelect } from "@/components/app/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { PrintButton, PrintStyles } from "@/features/production/components/print";
import { LABEL_SIZES, type LabelSize } from "@/features/production/components/product-label";
import { RawLotLabelCard } from "@/features/stock/components/raw-lot-label";
import { getRawLotLabel } from "@/features/stock/service";

export const metadata = { title: "Etiqueta de lote de materia prima" };

const MAX_COPIES = 200;
// El id llega de la URL: un valor que no es uuid haría fallar la consulta.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Etiqueta imprimible del lote de materia prima (RF-11). El QR contiene el id del lote
 * (`raw_lots.id`) y se escanea en el formulario de consumos. `?copias=N&formato=80x50`.
 */
export default async function RawLotLabelPage(props: PageProps<"/etiquetas/lote-mp/[id]">) {
  await requirePermission(["stock:read", "purchases:read"]);
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!UUID_RE.test(id)) notFound();
  const lot = await getRawLotLabel(db, id);
  if (!lot) notFound();

  const copies = Math.min(MAX_COPIES, Math.max(1, Math.floor(Number(sp.copias)) || 1));
  const size: LabelSize =
    typeof sp.formato === "string" && sp.formato in LABEL_SIZES ? (sp.formato as LabelSize) : "80x50";
  const { w, h } = LABEL_SIZES[size];
  const qrDataUrl = await QRCode.toDataURL(rawLotQrPayload(lot.id), {
    margin: 0,
    width: 400,
    errorCorrectionLevel: "M",
  });

  return (
    <>
      <PrintStyles pageSize={`${w}mm ${h}mm`} />
      <div className="print:hidden">
        <PageHeader
          title={`Etiqueta del lote ${lot.supplierLotCode ?? "sin código"} · ${lot.ingredient}`}
          description="Una etiqueta por página para impresora de etiquetas. El QR contiene el id del lote y se escanea al cargar consumos."
          actions={
            <>
              <Button variant="outline" asChild>
                <Link href={`/stock/insumos/${lot.ingredientId}`}>
                  <ArrowLeft /> Volver al insumo
                </Link>
              </Button>
              <PrintButton label="Imprimir etiquetas" />
            </>
          }
        />
        <form className="mb-6 flex flex-wrap items-end gap-3" aria-label="Opciones de impresión">
          <label className="grid gap-1 text-sm">
            Copias
            <Input
              name="copias"
              type="number"
              min={1}
              max={MAX_COPIES}
              defaultValue={copies}
              className="w-24"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Formato
            <NativeSelect name="formato" defaultValue={size} className="w-40">
              {Object.entries(LABEL_SIZES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <Button type="submit" variant="outline">
            Actualizar vista
          </Button>
        </form>
        <p className="text-muted-foreground mb-3 text-xs">
          QR: <span className="font-mono">{rawLotQrPayload(lot.id)}</span> · {copies} etiqueta
          {copies > 1 ? "s" : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-3 print:block print:gap-0">
        {Array.from({ length: copies }, (_, i) => (
          <RawLotLabelCard key={i} size={size} qrDataUrl={qrDataUrl} lot={lot} />
        ))}
      </div>
    </>
  );
}
