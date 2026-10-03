import { formatDateAR } from "@chipa/domain";
import { buildXlsx, cols } from "@/server/export/xlsx";
import { renderBpmPdf, type BpmSheet } from "@/server/export/pdf";
import { formatDateTimeAR } from "@/lib/dates";
import { DISPATCH_STATUS, formatDispatchNumber } from "./labels";
import type { RegistryRow } from "./service";

const periodText = (from: string, to: string) => `${formatDateAR(from)} al ${formatDateAR(to)}`;

const obs = (r: RegistryRow) => (r.status === "rejected" ? "Rechazado, devuelto a stock" : "");

/** RF-28: planilla "Registro de despacho" (BPM-DESP) en PDF, con el formato de papel que conoce ASSAL. */
export async function buildRegistryPdf(rows: RegistryRow[], f: { from: string; to: string }) {
  const sheet: BpmSheet = {
    title: "Registro de despacho",
    code: "BPM-DESP",
    period: periodText(f.from, f.to),
    orientation: "landscape",
    columns: [
      { header: "Producto", width: 3 },
      { header: "Lote", width: 1.4 },
      { header: "Fecha de despacho", width: 1.3 },
      { header: "Cantidad (u.)", width: 1, align: "right" },
      { header: "Kg", width: 0.9, align: "right" },
      { header: "Destino", width: 3 },
      { header: "Transporte / patente", width: 2.6 },
      { header: "Responsable", width: 2 },
      { header: "Observaciones", width: 1.6 },
    ],
    rows: rows.map((r) => [
      r.productName,
      r.lotCode,
      formatDateAR(r.date),
      r.qtyUnits,
      r.kg,
      r.destination,
      r.transport,
      r.responsible ?? "",
      obs(r),
    ]),
    notes: `Generado automáticamente desde los remitos (${rows.length} ${rows.length === 1 ? "línea" : "líneas"}).`,
    signatures: ["Responsable de despacho", "Supervisión / Responsable técnico"],
  };
  return renderBpmPdf(sheet, formatDateTimeAR(new Date()));
}

/** RF-28: el mismo registro en Excel (una fila por producto y lote). */
export async function buildRegistryXlsx(rows: RegistryRow[]) {
  return buildXlsx([
    {
      name: "Registro de despacho",
      rows,
      columns: cols<RegistryRow>([
        { header: "Producto", value: (r) => r.productName, width: 30 },
        { header: "Lote", value: (r) => r.lotCode, width: 12 },
        { header: "Vencimiento", value: (r) => r.expiryDate, format: "date", width: 13 },
        { header: "Fecha de despacho", value: (r) => r.date, format: "date", width: 17 },
        { header: "Cantidad (u.)", value: (r) => r.qtyUnits, format: "int", width: 14 },
        { header: "Kg", value: (r) => r.kg, format: "qty", width: 10 },
        { header: "Destino", value: (r) => r.destination, width: 40 },
        { header: "Transporte", value: (r) => r.transport, width: 34 },
        { header: "Patente", value: (r) => r.plate, width: 11 },
        { header: "Responsable", value: (r) => r.responsible, width: 22 },
        { header: "Remito", value: (r) => formatDispatchNumber(r.dispatchNumber), width: 14 },
        { header: "Estado", value: (r) => DISPATCH_STATUS[r.status]?.label, width: 18 },
      ]),
    },
  ]);
}
