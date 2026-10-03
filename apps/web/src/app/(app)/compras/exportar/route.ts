import ExcelJS from "exceljs";
import { formatDateAR, formatInvoiceNumber } from "@chipa/domain";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { purchasesForExport } from "@/features/purchases/service";
import { INVOICE_TYPE } from "@/features/purchases/labels";
import { can } from "@/lib/rbac";
import { todayAR } from "@/lib/dates";
import { logExport } from "@/server/export/log";

const MONEY = '"$" #,##0.00';

/** Compras confirmadas del mes en Excel, para la contadora (permiso `export` o `purchases:read`). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("No autorizado", { status: 401 });
  if (!can(user.role, ["export", "purchases:read"])) return new Response("Sin permiso", { status: 403 });

  const param = new URL(req.url).searchParams.get("mes");
  const month = param && /^\d{4}-\d{2}$/.test(param) ? param : todayAR().slice(0, 7);
  const { invoices, items } = await purchasesForExport(db, month);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Chipa Cheese";

  const sheet = wb.addWorksheet("Compras");
  sheet.columns = [
    { header: "Fecha", key: "date", width: 12 },
    { header: "Comprobante", key: "type", width: 18 },
    { header: "Número", key: "number", width: 16 },
    { header: "Proveedor", key: "supplier", width: 30 },
    { header: "CUIT", key: "cuit", width: 16 },
    { header: "Neto", key: "net", width: 16, style: { numFmt: MONEY } },
    { header: "IVA", key: "vat", width: 16, style: { numFmt: MONEY } },
    { header: "Percepciones y otros", key: "other", width: 20, style: { numFmt: MONEY } },
    { header: "Total", key: "total", width: 16, style: { numFmt: MONEY } },
    { header: "Vencimiento", key: "due", width: 14 },
  ];
  for (const i of invoices) {
    const sign = i.invoiceType.startsWith("NC_") ? -1 : 1; // las notas de crédito restan
    sheet.addRow({
      date: i.issueDate ? formatDateAR(i.issueDate) : "",
      type: INVOICE_TYPE[i.invoiceType],
      number: formatInvoiceNumber(i.pointOfSale, i.number),
      supplier: i.supplier?.legalName ?? "",
      cuit: i.supplier?.cuit ?? "",
      net: sign * i.netTotal,
      vat: sign * i.vatTotal,
      other: sign * i.otherTaxes,
      total: sign * i.total,
      due: i.dueDate ? formatDateAR(i.dueDate) : "",
    });
  }
  const last = invoices.length + 1;
  const totals = sheet.addRow({
    supplier: "TOTAL",
    net: { formula: `SUM(F2:F${last})` },
    vat: { formula: `SUM(G2:G${last})` },
    other: { formula: `SUM(H2:H${last})` },
    total: { formula: `SUM(I2:I${last})` },
  });
  totals.font = { bold: true };
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const detail = wb.addWorksheet("Detalle");
  detail.columns = [
    { header: "Comprobante", key: "invoice", width: 20 },
    { header: "Proveedor", key: "supplier", width: 30 },
    { header: "Descripción", key: "description", width: 36 },
    { header: "Insumo", key: "ingredient", width: 28 },
    { header: "Cantidad", key: "qty", width: 12 },
    { header: "Unidad", key: "unit", width: 8 },
    { header: "Precio neto unit.", key: "price", width: 16, style: { numFmt: MONEY } },
    { header: "Alícuota %", key: "rate", width: 10 },
    { header: "IVA", key: "vat", width: 14, style: { numFmt: MONEY } },
    { header: "Total línea", key: "total", width: 16, style: { numFmt: MONEY } },
  ];
  const byId = new Map(invoices.map((i) => [i.id, i]));
  for (const it of items) {
    const inv = byId.get(it.invoiceId)!;
    detail.addRow({
      invoice: `${inv.invoiceType.replace("_", " ")} ${formatInvoiceNumber(inv.pointOfSale, inv.number)}`,
      supplier: inv.supplier?.legalName ?? "",
      description: it.description,
      ingredient: it.ingredient?.name ?? "",
      qty: it.qty,
      unit: it.unit ?? "",
      price: it.unitPriceNet,
      rate: it.vatRate,
      vat: it.vatAmount,
      total: it.lineTotal,
    });
  }
  detail.getRow(1).font = { bold: true };
  detail.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  await logExport(user.id, "compras_xlsx", { mes: month });
  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="compras-${month}.xlsx"`,
    },
  });
}
