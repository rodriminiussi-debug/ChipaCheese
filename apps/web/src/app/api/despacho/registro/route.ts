import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { pdfResponse } from "@/server/export/pdf";
import { xlsxResponse } from "@/server/export/xlsx";
import { can } from "@/lib/rbac";
import { buildRegistryPdf, buildRegistryXlsx } from "@/features/dispatch/export";
import { listDispatchRegistry } from "@/features/dispatch/service";
import { registryFiltersFromParams } from "@/features/dispatch/schemas";

export const dynamic = "force-dynamic";

/**
 * RF-28: registro de despacho BPM en PDF (`?formato=pdf`, por defecto) o Excel (`?formato=xlsx`).
 * Permiso `dispatch:read` (también lo tiene el responsable técnico).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sesión requerida", { status: 401 });
  if (!can(user.role, "dispatch:read")) return new Response("Sin permiso", { status: 403 });

  const params = new URL(req.url).searchParams;
  const filters = registryFiltersFromParams(Object.fromEntries(params));
  const rows = await listDispatchRegistry(db, filters);
  const name = `registro-despacho-${filters.from}_${filters.to}`;
  if (params.get("formato") === "xlsx") return xlsxResponse(await buildRegistryXlsx(rows), `${name}.xlsx`);
  return pdfResponse(await buildRegistryPdf(rows, filters), `${name}.pdf`);
}
