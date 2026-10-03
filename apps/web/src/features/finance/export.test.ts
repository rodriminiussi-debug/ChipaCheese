import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../../tests/helpers";
import { buildResultWorkbook } from "./export";

describe("exportación del resultado mensual", () => {
  it("septiembre: P&L, ventas por canal, costo de ventas, gastos fijos y avisos", async () => {
    await inRollback("nahuel", async (tx) => {
      const buf = await buildResultWorkbook(tx, "2026-09");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      expect(wb.worksheets.map((w) => w.name)).toEqual([
        "Resultado",
        "Ventas por canal",
        "Costo de ventas",
        "Gastos fijos",
        "Avisos",
      ]);

      const pnl = wb.getWorksheet("Resultado")!;
      const line = (label: string) => {
        for (let i = 2; i <= pnl.rowCount; i++)
          if (pnl.getRow(i).getCell(1).value === label) return pnl.getRow(i).getCell(2).value;
        throw new Error(`falta la línea ${label}`);
      };
      expect(line("Ventas netas (sin IVA)")).toBe(386776.86);
      expect(line("Costo de ventas")).toBe(-335059.2);
      expect(line("Margen bruto")).toBe(51717.66);
      expect(line("Mano de obra de planta")).toBe(-120000);
      expect(line("Gastos fijos")).toBe(-1040000);
      expect(line("Resultado")).toBe(-1108282.34);
      expect(line("Retiros de los socios")).toBe(-9000000);
      expect(line("Falta para cubrir los retiros")).toBe(-10108282.34);

      expect(wb.getWorksheet("Ventas por canal")!.getRow(2).getCell(1).value).toBe("Supermercado");
      expect(wb.getWorksheet("Costo de ventas")!.rowCount).toBe(3); // encabezado + tapitas + lengüitas
      expect(wb.getWorksheet("Gastos fijos")!.rowCount).toBe(8); // encabezado + 7 conceptos
      const notices = wb.getWorksheet("Avisos")!;
      const text = Array.from({ length: notices.rowCount - 1 }, (_, i) => String(notices.getRow(i + 2).getCell(1).value));
      expect(text.some((t) => t.includes("6 pedido(s) entregados en el mes sin factura"))).toBe(true);
    });
  });
});
