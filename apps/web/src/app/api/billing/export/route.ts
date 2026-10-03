import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { can } from "@/lib/rbac";
import { todayAR } from "@/lib/dates";
import { buildBillingWorkbook } from "@/features/billing/export";
import { monthInput } from "@/features/billing/schemas";
import { xlsxResponse } from "@/server/export/xlsx";
import { logExport } from "@/server/export/log";

export const dynamic = "force-dynamic";

/** Excel de facturas emitidas y cobros del mes para la contadora (permiso `billing:read`; la contadora lo tiene junto con `export`). */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sesión requerida", { status: 401 });
  // Solo billing:read: `export` lo tiene también la jefa de producción, que no ve finanzas.
  if (!can(user.role, "billing:read")) return new Response("Sin permiso", { status: 403 });
  const raw = new URL(request.url).searchParams.get("month") ?? todayAR().slice(0, 7);
  const parsed = monthInput.safeParse({ month: raw });
  if (!parsed.success) return new Response("Mes inválido (usá AAAA-MM)", { status: 400 });
  const buffer = await buildBillingWorkbook(db, parsed.data.month);
  await logExport(user.id, "cobranzas_xlsx", { mes: parsed.data.month });
  return xlsxResponse(buffer, `cobranzas-${parsed.data.month}.xlsx`);
}
