import { ComingSoon } from "@/components/app/coming-soon";
import { requirePermission } from "@/server/auth/session";

export default async function Page() {
  await requirePermission("billing:read");
  return <ComingSoon title="Cobranzas" module="M6" rfs="RF-30 a RF-32" />;
}
