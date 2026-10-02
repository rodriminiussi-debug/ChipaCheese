import { ComingSoon } from "@/components/app/coming-soon";
import { requirePermission } from "@/server/auth/session";

export default async function Page() {
  await requirePermission(["dashboard:read", "finance:read"]);
  return <ComingSoon title="Tablero" module="M8" rfs="RF-39 a RF-42" />;
}
