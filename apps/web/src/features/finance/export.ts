import type { Executor } from "@chipa/db";
import { todayAR } from "@/lib/dates";
import { CHANNEL } from "@/lib/labels";
import { buildXlsx, cols } from "@/server/export/xlsx";
import { EXPENSE_CATEGORY } from "./labels";
import { getMonthlyResult, listFixedExpenses } from "./service";

/** Excel del resultado mensual: P&L, ventas por canal, costo de ventas, gastos fijos y aproximaciones. */
export async function buildResultWorkbook(db: Executor, month: string): Promise<Buffer> {
  const [r, fixed] = await Promise.all([
    getMonthlyResult(db, month, { today: todayAR() }),
    listFixedExpenses(db, month),
  ]);

  const pnl: { concept: string; amount: number | null; note?: string }[] = [
    { concept: "Ventas netas (sin IVA)", amount: r.sales },
    {
      concept: "Costo de ventas",
      amount: -r.costOfSales.total,
      note: "Materiales de las unidades facturadas y vendidas en el local, a los últimos precios de compra",
    },
    { concept: "Margen bruto", amount: r.grossMargin },
    {
      concept: "Mano de obra de planta",
      amount: -r.labor.total,
      note: `${r.labor.runs} producción(es) × costo de una producción`,
    },
    { concept: "Gastos fijos", amount: -r.fixed.total },
    { concept: "Reparto", amount: -r.delivery.cost, note: `${r.delivery.routes} ruta(s)` },
    {
      concept: "Resultado",
      amount: r.result,
      note: r.resultPct == null ? undefined : `${r.resultPct} % de las ventas`,
    },
    { concept: "Retiros de los socios", amount: -r.withdrawals.amount },
    {
      concept: r.withdrawals.covers ? "Sobra después de los retiros" : "Falta para cubrir los retiros",
      amount: r.withdrawals.difference,
    },
  ];

  return buildXlsx([
    {
      name: "Resultado",
      rows: pnl,
      columns: cols<(typeof pnl)[number]>([
        { header: `Resultado ${month}`, value: (x) => x.concept, width: 42 },
        { header: "Importe", value: (x) => x.amount, format: "money", width: 18 },
        { header: "Detalle", value: (x) => x.note ?? null, width: 70 },
      ]),
    },
    {
      name: "Ventas por canal",
      rows: r.salesByChannel,
      columns: cols<(typeof r.salesByChannel)[number]>([
        { header: "Canal", value: (x) => CHANNEL[x.channel] ?? x.channel, width: 20 },
        { header: "Neto sin IVA", value: (x) => x.net, format: "money", width: 18 },
        { header: "Total con IVA", value: (x) => x.total, format: "money", width: 18 },
        { header: "Comprobantes", value: (x) => x.documents, format: "int" },
      ]),
    },
    {
      name: "Costo de ventas",
      rows: r.costOfSales.lines,
      columns: cols<(typeof r.costOfSales.lines)[number]>([
        { header: "Producto", value: (x) => x.name, width: 34 },
        { header: "Unidades", value: (x) => x.units, format: "int" },
        { header: "Materiales por unidad", value: (x) => x.unitMaterialCost, format: "money", width: 22 },
        { header: "Costo", value: (x) => x.cost, format: "money", width: 18 },
      ]),
    },
    {
      name: "Gastos fijos",
      rows: fixed.rows,
      columns: cols<(typeof fixed.rows)[number]>([
        { header: "Concepto", value: (x) => x.concept, width: 30 },
        { header: "Categoría", value: (x) => EXPENSE_CATEGORY[x.category] ?? x.category, width: 20 },
        { header: "Importe", value: (x) => x.amount, format: "money", width: 18 },
        { header: "Notas", value: (x) => x.notes, width: 40 },
      ]),
    },
    {
      name: "Avisos",
      rows: notices(r),
      columns: cols<{ text: string }>([
        { header: "Qué no entra en la cuenta", value: (x) => x.text, width: 110 },
      ]),
    },
  ]);
}

function notices(r: Awaited<ReturnType<typeof getMonthlyResult>>): { text: string }[] {
  const out: { text: string }[] = [];
  if (r.notices.deliveredWithoutInvoice.orders > 0)
    out.push({
      text: `${r.notices.deliveredWithoutInvoice.orders} pedido(s) entregados en el mes sin factura (${r.notices.deliveredWithoutInvoice.amount} en pedidos): no suman a las ventas ni al costo.`,
    });
  if (r.notices.invoicesWithoutOrder.count > 0)
    out.push({
      text: `${r.notices.invoicesWithoutOrder.count} factura(s) sin pedido asociado (${r.notices.invoicesWithoutOrder.net} neto): suman ventas pero no tienen costo de ventas.`,
    });
  if (r.costOfSales.underpriced.length > 0)
    out.push({ text: `Costo subestimado por precios faltantes: ${r.costOfSales.underpriced.join(", ")}.` });
  if (r.fixed.missingCategories.length > 0)
    out.push({
      text: `Sin gastos cargados en: ${r.fixed.missingCategories.map((m) => m.label).join(", ")}.`,
    });
  out.push({
    text: "Aproximación: el costo de ventas usa los últimos precios de compra y el rendimiento real vigentes, no los de la fecha de cada venta.",
  });
  return out;
}
