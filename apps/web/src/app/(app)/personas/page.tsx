import { ComingSoon } from "@/components/app/coming-soon";
import { requirePermission } from "@/server/auth/session";

export default async function Page() {
  await requirePermission("people:read");
  return <ComingSoon title="Personas y tareas" module="M4" rfs="RF-23" />;
}
