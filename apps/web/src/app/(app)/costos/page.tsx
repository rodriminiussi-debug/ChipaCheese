import { ComingSoon } from "@/components/app/coming-soon";
import { requirePermission } from "@/server/auth/session";

export default async function Page() {
  await requirePermission("finance:read");
  return <ComingSoon title="Gastos y costeo" module="M8" rfs="RF-39, RF-42" />;
}
