import { ComingSoon } from "@/components/app/coming-soon";
import { requirePermission } from "@/server/auth/session";

export default async function Page() {
  await requirePermission("store:read");
  return <ComingSoon title="Local" module="M6" rfs="RF-33" />;
}
