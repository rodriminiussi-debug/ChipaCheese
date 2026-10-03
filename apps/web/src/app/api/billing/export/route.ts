import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { can } from "@/lib/rbac";
import { todayAR } from "@/lib/dates";
import { buildBillingWorkbook } from "@/features/billing/export";
import { monthInput } from "@/features/billing/schemas";
import { xlsxResponse } from "@/server/export/xlsx";

export const dynamic = "force-dynamic";

/** Excel de facturas emitidas y cobros del mes para la contadora (permiso `export` o `billing:read`). */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sesión requerida", { status: 401 });
  if (!can(user.role, ["export", "billing:read"])) return new Response("Sin permiso", { status: 403 });
  const raw = new URL(request.url).searchParams.get("month") ?? todayAR().slice(0, 7);
  const parsed = monthInput.safeParse({ month: raw });
  if (!parsed.success) return new Response("Mes inválido (usá AAAA-MM)", { status: 400 });
  const buffer = await buildBillingWorkbook(db, parsed.data.month);
  return xlsxResponse(buffer, `cobranzas-${parsed.data.month}.xlsx`);
}
