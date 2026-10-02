import { ComingSoon } from "@/components/app/coming-soon";
import { requirePermission } from "@/server/auth/session";

export default async function Page() {
  await requirePermission("stock:read");
  return <ComingSoon title="Stock" module="M3" rfs="RF-13 a RF-17" />;
}
