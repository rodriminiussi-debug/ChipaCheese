import { formatDateAR } from "@chipa/domain";
import { fmtQty } from "../format";

export const LABEL_SIZES = {
  "100x60": { w: 100, h: 60, label: "100 × 60 mm" },
  "80x50": { w: 80, h: 50, label: "80 × 50 mm" },
  "60x40": { w: 60, h: 40, label: "60 × 40 mm" },
} as const;
export type LabelSize = keyof typeof LABEL_SIZES;

/** Peso neto legible: 0,5 kg → "500 g"; 5 kg → "5 kg". */
function netWeightText(kg: number) {
  return kg < 1 ? `${fmtQty(kg * 1000, 0)} g` : `${fmtQty(kg)} kg`;
}

/**
 * Etiqueta de bolsa (RF-22): producto, lote, elaboración, vencimiento, peso neto, conservación y QR que
 * apunta a la trazabilidad del lote. Tamaño físico en mm para impresora de etiquetas (una por página).
 */
export function ProductLabel({
  size,
  qrDataUrl,
  product,
  lot,
}: {
  size: LabelSize;
  qrDataUrl: string;
  product: { name: string; netWeightKg: number };
  lot: { code: string; productionDate: string; expiryDate: string };
}) {
  const { w, h } = LABEL_SIZES[size];
  const small = w < 80;
  return (
    <div
      className="label-page flex overflow-hidden border border-black bg-white text-black"
      style={{ width: `${w}mm`, height: `${h}mm`, padding: "2.5mm", gap: "2mm", breakAfter: "page" }}
      data-testid="product-label"
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
            Chipa Cheese
          </p>
          <p className={small ? "text-[11px] font-bold" : "text-sm font-bold"}>{product.name}</p>
        </div>
        <dl className={small ? "text-[9px]" : "text-[11px]"}>
          <div className="flex gap-1">
            <dt>Lote:</dt>
            <dd className="font-bold">{lot.code}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Elab.:</dt>
            <dd>{formatDateAR(lot.productionDate)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Vence:</dt>
            <dd className="font-bold">{formatDateAR(lot.expiryDate)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Peso neto:</dt>
            <dd>{netWeightText(product.netWeightKg)}</dd>
          </div>
        </dl>
        <div className={small ? "text-[8px]" : "text-[10px]"}>
          <p className="font-bold">Mantener congelado a −18 °C</p>
          <p>Pacon SRL · Rosario, Santa Fe</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL generada en el servidor */}
        <img
          src={qrDataUrl}
          alt={`Código QR de trazabilidad del lote ${lot.code}`}
          style={{ width: `${Math.min(h - 12, 32)}mm`, height: `${Math.min(h - 12, 32)}mm` }}
        />
        <span className="text-[8px]">Trazabilidad</span>
      </div>
    </div>
  );
}
