import { ComingSoon } from "@/components/app/coming-soon";
import { requirePermission } from "@/server/auth/session";

export default async function Page() {
  await requirePermission("admin");
  return <ComingSoon title="Configuración" module="Plataforma" rfs="Usuarios y parámetros" />;
}
