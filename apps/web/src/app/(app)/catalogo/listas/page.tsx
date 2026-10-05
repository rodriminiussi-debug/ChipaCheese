import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { PriceListManager } from "@/features/catalog/components/price-list-manager";
import { listPriceLists } from "@/features/catalog/service";

export const metadata = { title: "Catálogo · Listas de precios" };

export default async function PriceListsPage() {
  await requirePermission("catalog:write");
  return (
    <>
      <PageHeader
        title="Listas de precios"
        description="Una lista por canal, con su margen objetivo. Para un canal nuevo podés copiar los precios de otra lista con un ajuste en %."
      />
      <PriceListManager rows={await listPriceLists(db)} />
    </>
  );
}
