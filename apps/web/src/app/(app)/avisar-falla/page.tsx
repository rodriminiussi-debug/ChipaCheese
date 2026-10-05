import { PageHeader } from "@/components/app/page-header";
import { ReportFaultForm } from "@/features/maintenance/components/report-fault-form";
import { faultEquipmentOptions } from "@/features/maintenance/service";
import { homeFor } from "@/lib/rbac";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Avisar una falla" };

/**
 * Aviso de falla fuera del modo planta: el chofer (equipo de frío del vehículo), el local (freezers) y la
 * jefa. `?equipo=<id>` deja el equipo ya elegido; `?volver=` es a dónde vuelve al terminar.
 */
export default async function ReportFaultPage(props: PageProps<"/avisar-falla">) {
  const user = await requirePermission("maintenance:report");
  const sp = await props.searchParams;
  const equipment = await faultEquipmentOptions(db);
  const back =
    typeof sp.volver === "string" && /^\/[a-z0-9/_-]*$/i.test(sp.volver) ? sp.volver : homeFor(user.role);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Avisar una falla"
        description="Elegí el equipo y contá qué pasa: Mantenimiento lo ve enseguida."
      />
      <ReportFaultForm
        equipment={equipment}
        defaultEquipmentId={typeof sp.equipo === "string" ? sp.equipo : null}
        backHref={back}
      />
    </div>
  );
}
