import { ComingSoon } from "@/components/app/coming-soon";
import { requirePermission } from "@/server/auth/session";

export default async function Page() {
  await requirePermission("catalog:write");
  return <ComingSoon title="Catálogo" module="Configuración" rfs="Productos, insumos, zonas, listas, vehículos y equipos" />;
}
