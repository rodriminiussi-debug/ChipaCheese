import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { NativeSelect } from "@/components/app/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/env";
import { PrintButton, PrintStyles } from "@/features/production/components/print";
import { LABEL_SIZES, ProductLabel, type LabelSize } from "@/features/production/components/product-label";
import { getLotByCode } from "@/features/production/service";

export const metadata = { title: "Etiqueta de lote" };

const MAX_COPIES = 500;

/**
 * Etiquetas imprimibles del lote (RF-22): una por página al tamaño de la impresora de etiquetas, con QR a
 * `${APP_URL}/calidad/trazabilidad?lote=<código>`. `?producto=<id>&copias=N&formato=100x60`.
 */
export default async function LabelPage(props: PageProps<"/produccion/lotes/[code]/etiqueta">) {
  await requirePermission("production:read");
  const { code } = await props.params;
  const sp = await props.searchParams;
  const lot = await getLotByCode(db, decodeURIComponent(code));
  if (!lot) notFound();

  const products = [...new Map(lot.packings.map((p) => [p.productId, p.product])).values()];
  if (!products.length) notFound();
  const product = products.find((p) => p.id === sp.producto) ?? products[0]!;
  const packedUnits = lot.packings.filter((p) => p.productId === product.id).reduce((a, p) => a + p.units, 0);
  const copies = Math.min(MAX_COPIES, Math.max(1, Math.floor(Number(sp.copias)) || 1));
  const size: LabelSize =
    typeof sp.formato === "string" && sp.formato in LABEL_SIZES ? (sp.formato as LabelSize) : "100x60";
  const { w, h } = LABEL_SIZES[size];

  const traceUrl = `${env.APP_URL}/calidad/trazabilidad?lote=${encodeURIComponent(lot.code)}`;
  const qrDataUrl = await QRCode.toDataURL(traceUrl, { margin: 0, width: 400, errorCorrectionLevel: "M" });

  return (
    <>
      <PrintStyles pageSize={`${w}mm ${h}mm`} />
      <div className="print:hidden">
        <PageHeader
          title={`Etiqueta del lote ${lot.code}`}
          description="Una etiqueta por página para impresora de etiquetas. El QR lleva a la trazabilidad del lote."
          actions={
            <>
              <Button variant="outline" asChild>
                <Link href={`/produccion/lotes/${lot.code}`}>
                  <ArrowLeft /> Volver al lote
                </Link>
              </Button>
              <PrintButton label="Imprimir etiquetas" />
            </>
          }
        />
        <form className="mb-6 flex flex-wrap items-end gap-3" aria-label="Opciones de impresión">
          <label className="grid gap-1 text-sm">
            Producto
            <NativeSelect name="producto" defaultValue={product.id} className="w-64">
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </label>
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
          <Button variant="ghost" asChild>
            <Link
              href={`/produccion/lotes/${lot.code}/etiqueta?producto=${product.id}&copias=${Math.min(packedUnits, MAX_COPIES)}&formato=${size}`}
            >
              Una por bolsa ({packedUnits})
            </Link>
          </Button>
        </form>
        <p className="text-muted-foreground mb-3 text-xs">
          QR: <span className="font-mono">{traceUrl}</span> · {copies} etiqueta{copies > 1 ? "s" : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-3 print:block print:gap-0">
        {Array.from({ length: copies }, (_, i) => (
          <ProductLabel key={i} size={size} qrDataUrl={qrDataUrl} product={product} lot={lot} />
        ))}
      </div>
    </>
  );
}
