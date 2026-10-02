import { ComingSoon } from "@/components/app/coming-soon";
import { requirePermission } from "@/server/auth/session";

export default async function Page() {
  await requirePermission("orders:read");
  return <ComingSoon title="Pedidos" module="M1" rfs="RF-02 a RF-05" />;
}
