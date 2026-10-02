import { ComingSoon } from "@/components/app/coming-soon";
import { requirePermission } from "@/server/auth/session";

export default async function Page() {
  await requirePermission("purchases:read");
  return <ComingSoon title="Compras" module="M2" rfs="RF-08 a RF-12" />;
}
