import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildXlsx, cols } from "./xlsx";

describe("exportación a Excel", () => {
  it("genera hoja con encabezados, formatos y fechas", async () => {
    const rows = [{ name: "Fécula", qty: 150, price: 1728, date: "2026-09-29" }];
    const buf = await buildXlsx([
      {
        name: "Stock",
        rows,
        columns: cols<(typeof rows)[number]>([
          { header: "Insumo", value: (r) => r.name },
          { header: "Cantidad", value: (r) => r.qty, format: "qty" },
          { header: "Precio", value: (r) => r.price, format: "money" },
          { header: "Fecha", value: (r) => r.date, format: "date" },
        ]),
      },
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Stock")!;
    expect(ws.getRow(1).getCell(1).value).toBe("Insumo");
    expect(ws.getRow(2).getCell(2).value).toBe(150);
    expect(ws.getRow(2).getCell(4).value).toBeInstanceOf(Date);
  });
});
