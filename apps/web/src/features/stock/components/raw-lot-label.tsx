import { formatDateAR } from "@chipa/domain";
import { LABEL_SIZES, type LabelSize } from "@/features/production/components/product-label";
import { UNIT } from "@/lib/labels";
import { toIsoDateAR } from "@/lib/dates";
import type { RawLotLabel } from "../service";

/**
 * Etiqueta del lote de materia prima (RF-11): insumo, lote y vencimiento del proveedor, cantidad recibida
 * y un QR con el id del lote, que se escanea en el formulario de consumos de producción.
 */
export function RawLotLabelCard({
  size,
  qrDataUrl,
  lot,
}: {
  size: LabelSize;
  qrDataUrl: string;
  lot: RawLotLabel;
}) {
  const { w, h } = LABEL_SIZES[size];
  const small = w < 80;
  const unit = UNIT[lot.unit] ?? lot.unit;
  return (
    <div
      className="label-page flex overflow-hidden border border-black bg-white text-black"
      style={{ width: `${w}mm`, height: `${h}mm`, padding: "2.5mm", gap: "2mm", breakAfter: "page" }}
      data-testid="raw-lot-label"
    >
      <div className="flex min-w-0 flex-1 flex-col justify-between leading-tight">
        <div>
          <p
            className={
              small
                ? "text-[9px] font-bold tracking-wide uppercase"
                : "text-[11px] font-bold tracking-wide uppercase"
            }
          >
            Materia prima · Chipa Cheese
          </p>
          <p className={small ? "text-[11px] font-bold" : "text-sm font-bold"}>{lot.ingredient}</p>
        </div>
        <dl className={small ? "text-[9px]" : "text-[11px]"}>
          <div className="flex gap-1">
            <dt>Lote proveedor:</dt>
            <dd className="font-bold">{lot.supplierLotCode ?? "s/d"}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Proveedor:</dt>
            <dd>{lot.supplier ?? "—"}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Vence:</dt>
            <dd className="font-bold">{lot.expiryDate ? formatDateAR(lot.expiryDate) : "s/d"}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Recibido:</dt>
            <dd>
              {lot.receivedAt ? formatDateAR(toIsoDateAR(lot.receivedAt)) : "—"} · {lot.receivedQty} {unit}
            </dd>
          </div>
        </dl>
        <p className={small ? "font-mono text-[7px]" : "font-mono text-[8px]"}>ID {lot.id.slice(0, 8)}</p>
      </div>
      <div className="flex shrink-0 flex-col items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL generada en el servidor */}
        <img
          src={qrDataUrl}
          alt={`Código QR del lote ${lot.supplierLotCode ?? lot.id}`}
          style={{ width: `${Math.min(h - 12, 32)}mm`, height: `${Math.min(h - 12, 32)}mm` }}
        />
        <span className="text-[8px]">Escanear en producción</span>
      </div>
    </div>
  );
}
