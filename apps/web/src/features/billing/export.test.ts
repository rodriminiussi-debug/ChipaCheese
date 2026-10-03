import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../../tests/helpers";
import { buildBillingWorkbook } from "./export";

describe("exportación para la contadora", () => {
  it("arma facturas emitidas, cobros (con cheques) y ventas por canal del mes", async () => {
    await inRollback("nahuel", async (tx) => {
      const buf = await buildBillingWorkbook(tx, "2026-09");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      expect(wb.worksheets.map((w) => w.name)).toEqual(["Facturas emitidas", "Cobros", "Ventas por canal"]);

      const invoices = wb.getWorksheet("Facturas emitidas")!;
      expect(invoices.getRow(1).getCell(1).value).toBe("Fecha");
      expect(invoices.rowCount).toBe(2); // encabezado + la factura de La Reina
      const inv = invoices.getRow(2);
      expect(inv.getCell(2).value).toBe("Factura A");
      expect(inv.getCell(3).value).toBe("0002");
      expect(inv.getCell(4).value).toBe("00001234");
      expect(inv.getCell(5).value).toBe("Supermercado La Reina");
      expect(inv.getCell(9).value).toBe(468000);

      const payments = wb.getWorksheet("Cobros")!;
      expect(payments.rowCount).toBe(2);
      const pay = payments.getRow(2);
      expect(pay.getCell(2).value).toBe("Supermercado La Reina");
      expect(pay.getCell(4).value).toBe("Cheque");
      expect(pay.getCell(5).value).toBe(200000);
      expect(pay.getCell(7).value).toBe("Banco Macro");
      expect(pay.getCell(8).value).toBe("45879632");

      const channels = wb.getWorksheet("Ventas por canal")!;
      expect(channels.getRow(2).getCell(1).value).toBe("supermarket");
      expect(channels.getRow(2).getCell(3).value).toBe(468000);

      // Un mes sin movimientos: solo encabezados.
      const empty = new ExcelJS.Workbook();
      await empty.xlsx.load((await buildBillingWorkbook(tx, "2026-01")) as unknown as ArrayBuffer);
      expect(empty.getWorksheet("Facturas emitidas")!.rowCount).toBe(1);
    });
  });
});
