import { buildResultWorkbook } from "@/features/finance/export";
import { monthString } from "@/features/finance/schemas";
import { todayAR } from "@/lib/dates";
import { can } from "@/lib/rbac";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { xlsxResponse } from "@/server/export/xlsx";

export const dynamic = "force-dynamic";

/** Excel del resultado mensual (RF-40). Solo con `finance:read` (el permiso `export` lo tiene también la jefa de producción). */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sesión requerida", { status: 401 });
  if (!can(user.role, "finance:read")) return new Response("Sin permiso", { status: 403 });
  const raw = new URL(request.url).searchParams.get("mes") ?? todayAR().slice(0, 7);
  const parsed = monthString().safeParse(raw);
  if (!parsed.success) return new Response("Mes inválido (usá AAAA-MM)", { status: 400 });
  const buffer = await buildResultWorkbook(db, parsed.data);
  return xlsxResponse(buffer, `resultado-${parsed.data}.xlsx`);
}
