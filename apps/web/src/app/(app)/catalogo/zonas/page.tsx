import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { ZoneManager } from "@/features/catalog/components/zone-manager";
import { listZones } from "@/features/catalog/service";

export const metadata = { title: "Catálogo · Zonas de reparto" };

export default async function ZonesPage() {
  await requirePermission("catalog:write");
  return (
    <>
      <PageHeader title="Zonas de reparto" description="Cada zona tiene sus días fijos de entrega." />
      <ZoneManager rows={await listZones(db)} />
    </>
  );
}
