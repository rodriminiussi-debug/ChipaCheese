import { ComingSoon } from "@/components/app/coming-soon";
import { requirePermission } from "@/server/auth/session";

export default async function Page() {
  await requirePermission(["finance:read", "prices:write"]);
  return <ComingSoon title="Listas de precios" module="M6" rfs="RF-29" />;
}
