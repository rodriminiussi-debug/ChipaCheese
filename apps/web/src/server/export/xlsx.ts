import "server-only";
import ExcelJS from "exceljs";

export interface XlsxColumn<T> {
  header: string;
  value: (row: T) => string | number | Date | null | undefined;
  /** Formato Excel: "money" ($ #.##0,00), "qty" (#.##0,000), "date", "int" o un numFmt explícito. */
  format?: "money" | "qty" | "date" | "int" | string;
  width?: number;
}

/** Amarillo de las cargas tardías (RF-36). */
export const HIGHLIGHT_ARGB = "FFFFE08A";

const FORMATS: Record<string, string> = {
  money: '"$" #,##0.00',
  qty: "#,##0.000",
  int: "#,##0",
  date: "dd/mm/yyyy",
};

/** Arma un .xlsx con una o varias hojas. Encabezado en negrita, fijado y con autofiltro. */
export async function buildXlsx(
  sheets: {
    name: string;
    columns: XlsxColumn<never>[];
    rows: unknown[];
    /** Índices de filas (sin contar el encabezado) a resaltar, p. ej. las cargas tardías de los registros BPM. */
    highlightRows?: number[];
    /** Celdas [fila, columna] (base 0, sin contar el encabezado) a resaltar. */
    highlightCells?: [number, number][];
  }[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Chipa Cheese — Sistema de gestión";
  wb.created = new Date();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31));
    ws.columns = sheet.columns.map((c) => ({
      header: c.header,
      width: c.width ?? Math.max(12, c.header.length + 2),
    }));
    for (const row of sheet.rows) {
      ws.addRow(
        sheet.columns.map((c) => {
          const v = c.value(row as never);
          // Fechas de negocio ISO → Date para que Excel las reconozca.
          if (c.format === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))
            return new Date(`${v}T12:00:00`);
          return v ?? null;
        }),
      );
    }
    sheet.columns.forEach((c, i) => {
      if (c.format) ws.getColumn(i + 1).numFmt = FORMATS[c.format] ?? c.format;
    });
    const fill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: HIGHLIGHT_ARGB } };
    for (const r of sheet.highlightRows ?? [])
      for (let c = 1; c <= sheet.columns.length; c++) ws.getCell(r + 2, c).fill = fill;
    for (const [r, c] of sheet.highlightCells ?? []) ws.getCell(r + 2, c + 1).fill = fill;
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Response de descarga para Route Handlers. */
export function xlsxResponse(buffer: Buffer, filename: string) {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
}

/** Helper tipado: columnas de un tipo T. */
export const cols = <T>(c: XlsxColumn<T>[]) => c as unknown as XlsxColumn<never>[];
