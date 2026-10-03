import { monthlyPriceSeries } from "@chipa/domain";
import type { Executor } from "@chipa/db";
import { buildXlsx, cols } from "@/server/export/xlsx";
import { UNIT } from "@/lib/labels";
import { monthLabel } from "./labels";
import { priceHistoryRows, type PriceHistoryRow } from "./prices";

interface MonthlyRow {
  ingredient: string;
  month: string;
  price: number;
  variationPct: number | null;
}

/** Último precio de cada mes por insumo (cualquier proveedor) y su variación contra el mes anterior. */
export function monthlyRows(rows: PriceHistoryRow[]): MonthlyRow[] {
  const byIngredient = new Map<string, PriceHistoryRow[]>();
  for (const r of rows) byIngredient.set(r.ingredient, [...(byIngredient.get(r.ingredient) ?? []), r]);
  return [...byIngredient].flatMap(([ingredient, list]) =>
    monthlyPriceSeries(list.map((r) => ({ date: r.date, price: r.unitPriceNet }))).map((m) => ({
      ingredient,
      ...m,
    })),
  );
}

/**
 * RF-09: historial de precios (neto, sin IVA) a Excel. Hoja "Historial" con cada compra y su variación contra
 * la anterior del mismo proveedor, y hoja "Mensual" con el último precio de cada mes por insumo y su variación.
 */
export async function buildPriceHistoryXlsx(db: Executor, ingredientId?: string): Promise<Buffer> {
  const rows = await priceHistoryRows(db, ingredientId);
  return buildXlsx([
    {
      name: "Historial",
      columns: cols<PriceHistoryRow>([
        { header: "Insumo", value: (r) => r.ingredient, width: 32 },
        { header: "Unidad", value: (r) => UNIT[r.unit] ?? r.unit, width: 9 },
        { header: "Proveedor", value: (r) => r.supplier, width: 28 },
        { header: "Fecha", value: (r) => r.date, format: "date", width: 12 },
        { header: "Precio neto", value: (r) => r.unitPriceNet, format: "money", width: 16 },
        { header: "Variación %", value: (r) => r.variationPct, format: "0.0", width: 12 },
        { header: "Factura", value: (r) => r.invoiceNumber, width: 18 },
      ]),
      rows,
    },
    {
      name: "Mensual",
      columns: cols<MonthlyRow>([
        { header: "Insumo", value: (r) => r.ingredient, width: 32 },
        { header: "Mes", value: (r) => monthLabel(r.month), width: 18 },
        { header: "Último precio del mes", value: (r) => r.price, format: "money", width: 22 },
        { header: "Variación mensual %", value: (r) => r.variationPct, format: "0.0", width: 20 },
      ]),
      rows: monthlyRows(rows),
    },
  ]);
}

/** Nombre de archivo: `precios-<insumo|todos>-<fecha>.xlsx`. */
export const priceHistoryFilename = (ingredient: string | null, today: string) =>
  `precios-${(ingredient ?? "todos")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-${today}.xlsx`;
