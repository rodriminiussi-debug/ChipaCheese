import { ComingSoon } from "@/components/app/coming-soon";
import { requirePermission } from "@/server/auth/session";

export default async function Page() {
  await requirePermission("maintenance:read");
  return <ComingSoon title="Mantenimiento" module="M7" rfs="RF-37" />;
}
