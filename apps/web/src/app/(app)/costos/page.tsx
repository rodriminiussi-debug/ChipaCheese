import { PageHeader } from "@/components/app/page-header";
import {
  CostHeadline,
  ExcelNote,
  IngredientBreakdown,
  MissingPricesAlert,
  ProductCostTable,
} from "@/features/finance/components/cost-sections";
import {
  SensitivitySimulator,
  type SimulatorData,
} from "@/features/finance/components/sensitivity-simulator";
import { getCostOverview } from "@/features/finance/service";
import { todayAR } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Gastos y costeo" };

export default async function CostsPage() {
  await requirePermission("finance:read");
  const overview = await getCostOverview(db, todayAR());
  const { costs } = overview;

  const simulator: SimulatorData = {
    starchKgPerRun: costs.starchKgPerRun,
    laborPerRun: costs.labor.costPerRun,
    producedKgPerRun: costs.producedKgPerRun,
    ingredients: costs.ingredients.map((l) => ({
      ingredientId: l.ingredientId,
      name: l.name,
      dairy: ["dairy", "fat"].includes(overview.categoryByIngredient[l.ingredientId] ?? ""),
      qty: l.qtyPerKgStarch * costs.starchKgPerRun,
      price: l.unitPriceNet,
    })),
    products: costs.products
      .filter((p) => p.kind === "manufactured")
      .map((p) => ({
        id: p.productId,
        name: p.name,
        netWeightKg: p.netWeightKg,
        components: p.components.map((c) => ({
          ingredientId: c.ingredientId,
          name: c.name,
          qty: c.qtyPerUnit,
          price: c.unitPriceNet,
        })),
      })),
    priceLists: overview.priceLists.map((l) => ({
      id: l.id,
      name: l.name,
      targetMarginPct: l.targetMarginPct,
      prices: l.prices,
    })),
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Costo por kg y por bolsa"
        description="Siempre con el último precio de compra sin IVA y el rendimiento real de las producciones (RF-39, Regla 8)."
      />
      <MissingPricesAlert overview={overview} />
      <CostHeadline overview={overview} />
      <IngredientBreakdown overview={overview} />
      <ProductCostTable overview={overview} />
      <SensitivitySimulator data={simulator} />
      <ExcelNote overview={overview} />
    </div>
  );
}
