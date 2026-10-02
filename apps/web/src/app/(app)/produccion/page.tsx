import { ComingSoon } from "@/components/app/coming-soon";
import { requirePermission } from "@/server/auth/session";

export default async function Page() {
  await requirePermission("production:read");
  return <ComingSoon title="Producción" module="M4" rfs="RF-19 a RF-22" />;
}
