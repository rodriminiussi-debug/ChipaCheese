import { PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CostSummary } from "@/features/costing/components/cost-breakdown";
import { PriceMatrix } from "@/features/pricing/components/price-matrix";
import { getPriceMatrix } from "@/features/pricing/service";
import { todayAR } from "@/lib/dates";
import { can } from "@/lib/rbac";
import { UserError } from "@/server/errors";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Listas de precios" };

export default async function PricesPage() {
  const user = await requirePermission(["finance:read", "prices:write"]);
  const today = todayAR();
  let matrix: Awaited<ReturnType<typeof getPriceMatrix>>;
  try {
    matrix = await getPriceMatrix(db, today);
  } catch (e) {
    if (e instanceof UserError) {
      return (
        <>
          <PageHeader
            title="Listas de precios"
            description="Precios por canal con margen sobre el costo actual (RF-29)."
          />
          <Alert variant="destructive">
            <AlertTitle>No se puede calcular el costo</AlertTitle>
            <AlertDescription>{e.message}</AlertDescription>
          </Alert>
        </>
      );
    }
    throw e;
  }

  return (
    <>
      <PageHeader
        title="Listas de precios"
        description="Precio, costo directo y margen por canal. El costo sale del último precio de compra y del rendimiento real (RF-29)."
      />
      <div className="grid gap-6">
        <CostSummary costs={matrix.costs} />
        <PriceMatrix lists={matrix.lists} today={today} canEdit={can(user.role, "prices:write")} />
      </div>
    </>
  );
}
