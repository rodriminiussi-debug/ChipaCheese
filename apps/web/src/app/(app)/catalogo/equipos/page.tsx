import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { EquipmentManager } from "@/features/catalog/components/fleet-managers";
import { listEquipment, listLocations } from "@/features/catalog/service";

export const metadata = { title: "Catálogo · Equipos" };

export default async function EquipmentPage() {
  await requirePermission("catalog:write");
  const [rows, locations] = await Promise.all([listEquipment(db), listLocations(db)]);
  return (
    <>
      <PageHeader
        title="Equipos"
        description="Máquinas, freezers y heladeras. Los de frío aparecen en el control de temperaturas; todos, en el mantenimiento."
      />
      <EquipmentManager
        rows={rows}
        locations={locations.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name }))}
      />
    </>
  );
}
