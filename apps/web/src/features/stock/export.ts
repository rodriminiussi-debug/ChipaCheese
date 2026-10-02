import ExcelJS from "exceljs";
import { formatDateAR } from "@chipa/domain";
import type { Executor } from "@chipa/db";
import { COVERAGE_STATUS } from "./labels";
import { getStockExportData } from "./service";

const UNIT = { kg: "kg", l: "L", unit: "u." } as const;

function style(sheet: ExcelJS.Worksheet) {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle", wrapText: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF4" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

/** Excel con el stock actual de materia prima y producto terminado (hojas: resumen y detalle por lote). */
export async function buildStockWorkbook(db: Executor): Promise<Buffer> {
  const data = await getStockExportData(db);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Chipa Cheese";
  wb.created = new Date();

  // --- Materia prima: resumen con cobertura
  const mp = wb.addWorksheet("Materia prima");
  mp.columns = [
    { header: "Insumo", key: "name", width: 34 },
    { header: "Unidad", key: "unit", width: 9 },
    { header: "Stock", key: "stock", width: 12, style: { numFmt: "#,##0.###" } },
    { header: "Stock mínimo", key: "min", width: 13, style: { numFmt: "#,##0.###" } },
    { header: "Stock de seguridad", key: "safety", width: 17, style: { numFmt: "#,##0.###" } },
    { header: "Consumo diario (30 d)", key: "avg", width: 19, style: { numFmt: "#,##0.###" } },
    { header: "Cobertura (días)", key: "coverage", width: 16, style: { numFmt: "#,##0.0" } },
    { header: "Punto de pedido", key: "rop", width: 15, style: { numFmt: "#,##0.###" } },
    { header: "Proveedor", key: "supplier", width: 22 },
    { header: "Plazo (días)", key: "lead", width: 12 },
    { header: "Próx. vencimiento", key: "expiry", width: 17 },
    { header: "Estado", key: "status", width: 14 },
  ];
  for (const c of data.coverage) {
    const exp = data.expiries[c.ingredientId];
    mp.addRow({
      name: c.name,
      unit: UNIT[c.unit],
      stock: c.stock,
      min: c.minStock,
      safety: c.safetyStock,
      avg: c.avgDailyConsumption,
      coverage: c.coverageDays,
      rop: c.reorderPoint,
      supplier: c.supplierName,
      lead: c.leadTimeDays,
      expiry: exp?.expiryDate ? formatDateAR(exp.expiryDate) : null,
      status: COVERAGE_STATUS[c.status].label,
    });
  }
  style(mp);

  // --- Materia prima: detalle por lote
  const mpl = wb.addWorksheet("Materia prima por lote");
  mpl.columns = [
    { header: "Insumo", key: "name", width: 34 },
    { header: "Unidad", key: "unit", width: 9 },
    { header: "Lote proveedor", key: "lot", width: 18 },
    { header: "Vencimiento", key: "expiry", width: 14 },
    { header: "Ubicación", key: "loc", width: 14 },
    { header: "Saldo", key: "qty", width: 12, style: { numFmt: "#,##0.###" } },
  ];
  for (const p of data.rawPositions) {
    mpl.addRow({
      name: p.ingredientName,
      unit: UNIT[p.unit],
      lot: p.lotCode ?? "Sin lote",
      expiry: p.expiryDate ? formatDateAR(p.expiryDate) : null,
      loc: p.locationCode,
      qty: p.qty,
    });
  }
  style(mpl);

  // --- Producto terminado: matriz
  const pt = wb.addWorksheet("Producto terminado");
  pt.columns = [
    { header: "Código", key: "code", width: 14 },
    { header: "Producto", key: "name", width: 34 },
    ...data.matrix.locations.map((l) => ({
      header: `${l.code} (u.)`,
      key: `loc_${l.id}`,
      width: 12,
      style: { numFmt: "#,##0" },
    })),
    { header: "Total (u.)", key: "units", width: 12, style: { numFmt: "#,##0" } },
    { header: "Total (kg)", key: "kg", width: 12, style: { numFmt: "#,##0.###" } },
    { header: "Mínimo (u.)", key: "min", width: 12, style: { numFmt: "#,##0" } },
    { header: "Estado", key: "status", width: 14 },
  ];
  for (const r of data.matrix.rows) {
    pt.addRow({
      code: r.code,
      name: r.name,
      ...Object.fromEntries(data.matrix.locations.map((l) => [`loc_${l.id}`, r.byLocation[l.id] ?? 0])),
      units: r.totalUnits,
      kg: r.totalKg,
      min: r.minStockUnits,
      status: r.belowMin ? "Bajo mínimo" : "OK",
    });
  }
  style(pt);

  // --- Producto terminado: detalle por lote
  const ptl = wb.addWorksheet("Producto terminado por lote");
  ptl.columns = [
    { header: "Código", key: "code", width: 14 },
    { header: "Producto", key: "name", width: 34 },
    { header: "Lote", key: "lot", width: 14 },
    { header: "Vencimiento", key: "expiry", width: 14 },
    { header: "Días restantes", key: "days", width: 14 },
    { header: "Ubicación", key: "loc", width: 12 },
    { header: "Unidades", key: "qty", width: 12, style: { numFmt: "#,##0" } },
    { header: "Kg", key: "kg", width: 12, style: { numFmt: "#,##0.###" } },
    { header: "Retenido", key: "hold", width: 10 },
  ];
  for (const l of data.lots) {
    ptl.addRow({
      code: l.productCode,
      name: l.productName,
      lot: l.lotCode ?? "Sin lote",
      expiry: l.expiryDate ? formatDateAR(l.expiryDate) : null,
      days: l.daysLeft,
      loc: l.locationCode,
      qty: l.qty,
      kg: Math.round(l.qty * l.netWeightKg * 1000) / 1000,
      hold: l.onHold ? "Sí" : "",
    });
  }
  style(ptl);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
