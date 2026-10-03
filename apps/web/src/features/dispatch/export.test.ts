import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildRegistryPdf, buildRegistryXlsx } from "./export";
import type { RegistryRow } from "./service";

const row = (over: Partial<RegistryRow> = {}): RegistryRow => ({
  id: "1",
  dispatchId: "d1",
  dispatchNumber: 12,
  date: "2026-10-02",
  dispatchedAt: new Date("2026-10-02T12:00:00-03:00"),
  productId: "p1",
  productName: "Chipá tapitas 0,5 kg",
  lotCode: "260901-1",
  expiryDate: "2027-03-01",
  qtyUnits: 60,
  kg: 30,
  destination: "Supermercado Arcoiris — Av. Pellegrini 1234",
  transport: "Utilitario con equipo de frío (AA000AA)",
  plate: "AA000AA",
  responsible: "Logística (chofer)",
  status: "delivered",
  ...over,
});

describe("registro de despacho BPM: exportación (RF-28)", () => {
  it("genera el PDF 'Registro de despacho' (BPM-DESP)", async () => {
    const pdf = await buildRegistryPdf([row(), row({ id: "2", lotCode: "261001-1", qtyUnits: 20 })], {
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it("genera el Excel con una fila por producto y lote", async () => {
    const buf = await buildRegistryXlsx([row(), row({ id: "2", lotCode: "261001-1", status: "rejected" })]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Registro de despacho")!;
    expect(ws.rowCount).toBe(3);
    expect(ws.getRow(1).values).toEqual(
      expect.arrayContaining(["Producto", "Lote", "Fecha de despacho", "Cantidad (u.)", "Destino"]),
    );
    expect(ws.getRow(2).getCell(2).value).toBe("260901-1");
    expect(ws.getRow(3).getCell(12).value).toBe("Rechazado");
  });
});
