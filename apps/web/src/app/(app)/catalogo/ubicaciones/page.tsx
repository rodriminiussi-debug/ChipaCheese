import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { LocationManager } from "@/features/catalog/components/fleet-managers";
import { listLocations } from "@/features/catalog/service";

export const metadata = { title: "Catálogo · Ubicaciones" };

export default async function LocationsPage() {
  await requirePermission("catalog:write");
  return (
    <>
      <PageHeader
        title="Ubicaciones y depósitos"
        description="Dónde se guarda el stock: depósitos, heladeras y freezers. Un freezer nuevo de producto terminado aparece en el stock y en las transferencias."
      />
      <LocationManager rows={await listLocations(db)} />
    </>
  );
}
