import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { pdfResponse, renderBpmPdf } from "@/server/export/pdf";
import { logExport } from "@/server/export/log";
import { can } from "@/lib/rbac";
import { formatDateTimeAR } from "@/lib/dates";
import { searchTrace } from "@/features/traceability/service";
import { traceSheet } from "@/features/traceability/export";

export const dynamic = "force-dynamic";

/** Informe de trazabilidad en PDF: GET /api/calidad/trazabilidad/pdf?lote=<código> */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sesión requerida", { status: 401 });
  if (!can(user.role, ["quality:read", "dispatch:read"])) return new Response("Sin permiso", { status: 403 });
  const term = new URL(req.url).searchParams.get("lote")?.trim();
  if (!term) return new Response("Falta el código de lote", { status: 400 });
  const result = await searchTrace(db, term);
  if (!result.finished && result.raw.length === 0) return new Response("Lote no encontrado", { status: 404 });
  const now = formatDateTimeAR(new Date());
  const pdf = await renderBpmPdf(traceSheet(result, now), now);
  await logExport(user.id, "traza_pdf", { lote: term });
  return pdfResponse(pdf, `trazabilidad-${term}.pdf`);
}
