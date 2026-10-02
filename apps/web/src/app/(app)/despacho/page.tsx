import { ComingSoon } from "@/components/app/coming-soon";
import { requirePermission } from "@/server/auth/session";

export default async function Page() {
  await requirePermission("dispatch:read");
  return <ComingSoon title="Despacho" module="M5" rfs="RF-24 a RF-28" />;
}
