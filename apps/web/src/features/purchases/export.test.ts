import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { eq, schema, type Tx } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { buildPriceHistoryXlsx, monthlyRows, priceHistoryFilename } from "./export";
import { priceHistoryRows } from "./prices";

async function seedPrices(tx: Tx) {
  const ing = (await tx.query.ingredients.findFirst({ where: eq(schema.ingredients.name, "Sal") }))!;
  const leo = (await tx.query.suppliers.findFirst({ where: eq(schema.suppliers.legalName, "Leo Pelle") }))!;
  const cotar = (await tx.query.suppliers.findFirst({ where: eq(schema.suppliers.legalName, "Cotar") }))!;
  await tx.insert(schema.ingredientPrices).values([
    { ingredientId: ing.id, supplierId: leo.id, date: "2026-06-10", unitPriceNet: 100 },
    { ingredientId: ing.id, supplierId: leo.id, date: "2026-07-10", unitPriceNet: 110 },
    { ingredientId: ing.id, supplierId: cotar.id, date: "2026-07-15", unitPriceNet: 90 },
    { ingredientId: ing.id, supplierId: leo.id, date: "2026-07-20", unitPriceNet: 121 },
  ]);
  return { ing, leo, cotar };
}

async function readSheet(buffer: Buffer, name: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet(name)!;
  return ws.getSheetValues().slice(1) as unknown[][];
}

describe("exportar historial de precios (RF-09)", () => {
  it("lista las compras por insumo y proveedor con la variación contra la compra anterior del mismo proveedor", async () => {
    await inRollback("contadora", async (tx) => {
      const { ing } = await seedPrices(tx);
      const rows = (await priceHistoryRows(tx, ing.id)).filter((r) => r.date < "2026-08-01");
      expect(rows.map((r) => [r.supplier, r.date, r.unitPriceNet, r.variationPct])).toEqual([
        ["Cotar", "2026-07-15", 90, null],
        ["Leo Pelle", "2026-06-10", 100, null],
        ["Leo Pelle", "2026-07-10", 110, 10],
        ["Leo Pelle", "2026-07-20", 121, 10],
      ]);
      expect(rows[0]).toMatchObject({ ingredient: "Sal", unit: "kg", invoiceNumber: null });
    });
  });

  it("sin insumo trae todos los insumos con historial", async () => {
    await inRollback("contadora", async (tx) => {
      await seedPrices(tx);
      const all = await priceHistoryRows(tx);
      expect(new Set(all.map((r) => r.ingredient)).size).toBeGreaterThan(1);
      expect(all.some((r) => r.ingredient === "Sal" && r.date === "2026-07-20")).toBe(true);
    });
  });

  it("el Excel tiene las hojas Historial y Mensual con precios, variaciones y fechas", async () => {
    await inRollback("contadora", async (tx) => {
      const { ing } = await seedPrices(tx);
      const buffer = await buildPriceHistoryXlsx(tx, ing.id);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      expect(wb.worksheets.map((w) => w.name)).toEqual(["Historial", "Mensual"]);

      const hist = await readSheet(buffer, "Historial");
      expect(hist[0]).toEqual([
        undefined,
        "Insumo",
        "Unidad",
        "Proveedor",
        "Fecha",
        "Precio neto",
        "Variación %",
        "Factura",
      ]);
      const last = hist.find((r) => r[3] === "Leo Pelle" && r[5] === 121)!;
      expect(last[1]).toBe("Sal");
      expect(last[6]).toBe(10);
      expect((last[4] as Date).toISOString().slice(0, 10)).toBe("2026-07-20");

      const monthly = await readSheet(buffer, "Mensual");
      const july = monthly.find((r) => r[3] === 121)!;
      expect(july[1]).toBe("Sal");
      expect(july[4]).toBe(21); // último precio de julio (121) contra el de junio (100)
    });
  });

  it("serie mensual: el último precio de cada mes y su variación", () => {
    const rows = monthlyRows([
      {
        ingredient: "A",
        unit: "kg",
        supplier: "x",
        date: "2026-06-10",
        unitPriceNet: 100,
        variationPct: null,
        invoiceNumber: null,
      },
      {
        ingredient: "A",
        unit: "kg",
        supplier: "x",
        date: "2026-07-10",
        unitPriceNet: 110,
        variationPct: 10,
        invoiceNumber: null,
      },
      {
        ingredient: "A",
        unit: "kg",
        supplier: "y",
        date: "2026-07-20",
        unitPriceNet: 120,
        variationPct: null,
        invoiceNumber: null,
      },
      {
        ingredient: "B",
        unit: "l",
        supplier: "x",
        date: "2026-07-01",
        unitPriceNet: 5,
        variationPct: null,
        invoiceNumber: null,
      },
    ]);
    expect(rows).toEqual([
      { ingredient: "A", month: "2026-06", price: 100, variationPct: null },
      { ingredient: "A", month: "2026-07", price: 120, variationPct: 20 },
      { ingredient: "B", month: "2026-07", price: 5, variationPct: null },
    ]);
  });

  it("nombre de archivo sin acentos ni espacios", () => {
    expect(priceHistoryFilename("Fécula de mandioca", "2026-10-02")).toBe(
      "precios-fecula-de-mandioca-2026-10-02.xlsx",
    );
    expect(priceHistoryFilename(null, "2026-10-02")).toBe("precios-todos-2026-10-02.xlsx");
  });
});
