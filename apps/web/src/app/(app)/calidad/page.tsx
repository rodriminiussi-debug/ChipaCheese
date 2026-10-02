import { ComingSoon } from "@/components/app/coming-soon";
import { requirePermission } from "@/server/auth/session";

export default async function Page() {
  await requirePermission("quality:read");
  return <ComingSoon title="Registros BPM" module="M7" rfs="RF-34, RF-36" />;
}
