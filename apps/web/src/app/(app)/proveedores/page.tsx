import { ComingSoon } from "@/components/app/coming-soon";
import { requirePermission } from "@/server/auth/session";

export default async function Page() {
  await requirePermission("suppliers:read");
  return <ComingSoon title="Proveedores" module="M2" rfs="RF-07" />;
}
