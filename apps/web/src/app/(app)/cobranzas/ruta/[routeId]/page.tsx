import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { DateText } from "@/components/app/format";
import { RouteCollectionsList } from "@/features/billing/components/route-collections";
import { getRouteCollections } from "@/features/billing/service";
import { todayAR } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Cobranza en ruta" };

/** RF-31: pantalla del chofer. Los clientes de las paradas con su saldo y el botón para cobrar. */
export default async function RouteCollectionsPage(props: PageProps<"/cobranzas/ruta/[routeId]">) {
  await requirePermission("collections:write");
  const { routeId } = await props.params;
  const today = todayAR();
  const data = /^[0-9a-f-]{36}$/i.test(routeId) ? await getRouteCollections(db, routeId, today) : null;
  if (!data) notFound();
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="Cobranza en ruta"
        description={
          <>
            Ruta del <DateText value={data.route.date} />
            {data.route.driverName ? ` · ${data.route.driverName}` : ""}
          </>
        }
      />
      <RouteCollectionsList data={data} today={today} />
    </div>
  );
}
