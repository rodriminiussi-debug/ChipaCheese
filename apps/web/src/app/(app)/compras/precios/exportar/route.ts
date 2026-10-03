import { eq, schema } from "@chipa/db";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { xlsxResponse } from "@/server/export/xlsx";
import { logExport } from "@/server/export/log";
import { can } from "@/lib/rbac";
import { todayAR } from "@/lib/dates";
import { buildPriceHistoryXlsx, priceHistoryFilename } from "@/features/purchases/export";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Historial de precios de compra en Excel (RF-09): GET /compras/precios/exportar[?insumo=<id>].
 * Sin `insumo` exporta todos. Queda registrado quién lo exportó (RF-36).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sesión requerida", { status: 401 });
  if (!can(user.role, ["export", "purchases:read"])) return new Response("Sin permiso", { status: 403 });
  const insumo = new URL(req.url).searchParams.get("insumo");
  if (insumo && !UUID.test(insumo)) return new Response("Insumo inválido", { status: 400 });
  const ingredient = insumo
    ? await db.query.ingredients.findFirst({ where: eq(schema.ingredients.id, insumo) })
    : null;
  if (insumo && !ingredient) return new Response("Insumo inexistente", { status: 404 });

  const buffer = await buildPriceHistoryXlsx(db, ingredient?.id);
  await logExport(user.id, "precios_xlsx", { insumo: ingredient?.name ?? "todos" });
  return xlsxResponse(buffer, priceHistoryFilename(ingredient?.name ?? null, todayAR()));
}
