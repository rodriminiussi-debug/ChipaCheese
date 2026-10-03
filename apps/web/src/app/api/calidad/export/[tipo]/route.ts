import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { pdfResponse, renderBpmPdf } from "@/server/export/pdf";
import { xlsxResponse } from "@/server/export/xlsx";
import { logExport } from "@/server/export/log";
import { can, type Permission } from "@/lib/rbac";
import { formatDateTimeAR, todayAR } from "@/lib/dates";
import { buildReport, sheetToXlsx, REPORT_KINDS, type ReportKind } from "@/features/quality/export";

export const dynamic = "force-dynamic";

/** Permiso de lectura del módulo dueño de cada registro (además de `export`). */
const READ_PERMISSION: Record<ReportKind, Permission> = {
  limpieza: "quality:read",
  temperaturas: "quality:read",
  reclamos: "quality:read",
  mantenimiento: "maintenance:read",
  elaboracion: "production:read",
  despacho: "dispatch:read",
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Exporta un registro BPM (RF-36) para un período, en PDF con el formato de la planilla o en Excel.
 * GET /api/calidad/export/<tipo>?desde=YYYY-MM-DD&hasta=YYYY-MM-DD[&mes=YYYY-MM][&formato=pdf|xlsx]
 */
export async function GET(req: Request, ctx: RouteContext<"/api/calidad/export/[tipo]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sesión requerida", { status: 401 });
  const { tipo } = await ctx.params;
  if (!(REPORT_KINDS as readonly string[]).includes(tipo))
    return new Response("Registro desconocido", { status: 404 });
  const kind = tipo as ReportKind;
  if (!can(user.role, "export") || !can(user.role, READ_PERMISSION[kind]))
    return new Response("Sin permiso", { status: 403 });

  const url = new URL(req.url);
  const today = todayAR();
  const monthParam = url.searchParams.get("mes");
  const month = monthParam && MONTH.test(monthParam) ? monthParam : undefined;
  const from = url.searchParams.get("desde") ?? (month ? `${month}-01` : `${today.slice(0, 7)}-01`);
  const to = url.searchParams.get("hasta") ?? today;
  if (!ISO.test(from) || !ISO.test(to) || from > to) return new Response("Período inválido", { status: 400 });
  const format = url.searchParams.get("formato") === "xlsx" ? "xlsx" : "pdf";

  const sheet = await buildReport(db, kind, { from, to, month }, today);
  const name = `${kind}-${kind === "limpieza" ? (month ?? from.slice(0, 7)) : `${from}_${to}`}`;
  const body =
    format === "xlsx" ? await sheetToXlsx(sheet) : await renderBpmPdf(sheet, formatDateTimeAR(new Date()));
  await logExport(user.id, `${kind}_${format}`, {
    desde: from,
    hasta: to,
    ...(kind === "limpieza" ? { mes: month ?? from.slice(0, 7) } : {}),
  });
  return format === "xlsx" ? xlsxResponse(body, `${name}.xlsx`) : pdfResponse(body, `${name}.pdf`);
}
