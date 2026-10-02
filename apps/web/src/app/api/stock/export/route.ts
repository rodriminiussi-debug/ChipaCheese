import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { can } from "@/lib/rbac";
import { todayAR } from "@/lib/dates";
import { buildStockWorkbook } from "@/features/stock/export";

export const dynamic = "force-dynamic";

/** Descarga Excel del stock actual de materia prima y producto terminado (permiso `export` o `stock:read`). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Sesión requerida", { status: 401 });
  if (!can(user.role, ["export", "stock:read"])) return new Response("Sin permiso", { status: 403 });
  const buffer = await buildStockWorkbook(db);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="stock-${todayAR()}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
