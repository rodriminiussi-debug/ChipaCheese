import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { xlsxResponse } from "@/server/export/xlsx";
import { logExport } from "@/server/export/log";
import { can } from "@/lib/rbac";
import { formatDateTimeAR } from "@/lib/dates";
import { searchTrace } from "@/features/traceability/service";
import { traceSheet } from "@/features/traceability/export";
import { sheetToXlsx } from "@/features/quality/export";

export const dynamic = "force-dynamic";

/** Informe de trazabilidad en Excel (RF-35): GET /api/calidad/trazabilidad/xlsx?lote=<código> */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sesión requerida", { status: 401 });
  if (!can(user.role, ["quality:read", "dispatch:read"])) return new Response("Sin permiso", { status: 403 });
  const term = new URL(req.url).searchParams.get("lote")?.trim();
  if (!term) return new Response("Falta el código de lote", { status: 400 });
  const result = await searchTrace(db, term);
  if (!result.finished && result.raw.length === 0) return new Response("Lote no encontrado", { status: 404 });
  const sheet = traceSheet(result, formatDateTimeAR(new Date()));
  const buffer = await sheetToXlsx(sheet);
  await logExport(user.id, "traza_xlsx", { lote: term });
  return xlsxResponse(buffer, `trazabilidad-${term}.xlsx`);
}
