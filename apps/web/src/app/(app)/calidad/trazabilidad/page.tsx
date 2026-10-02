import { ComingSoon } from "@/components/app/coming-soon";
import { requirePermission } from "@/server/auth/session";

export default async function Page() {
  await requirePermission(["quality:read", "dispatch:read"]);
  return <ComingSoon title="Trazabilidad" module="M7" rfs="RF-35" />;
}
