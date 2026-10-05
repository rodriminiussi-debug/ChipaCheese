import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { VehicleManager } from "@/features/catalog/components/fleet-managers";
import { listVehicles } from "@/features/catalog/service";

export const metadata = { title: "Catálogo · Vehículos" };

export default async function VehiclesPage() {
  await requirePermission("catalog:write");
  return (
    <>
      <PageHeader
        title="Vehículos"
        description="Vehículos de reparto, su equipo de frío y el costo por km."
      />
      <VehicleManager rows={await listVehicles(db)} />
    </>
  );
}
