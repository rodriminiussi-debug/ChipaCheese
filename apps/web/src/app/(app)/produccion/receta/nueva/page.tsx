import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { RecipeVersionForm } from "@/features/production/components/recipe-version-form";
import { getActiveRecipe, recipeIngredientOptions } from "@/features/production/service";

export const metadata = { title: "Nueva versión de la receta" };

export default async function NewRecipeVersionPage() {
  await requirePermission("recipes:write");
  const [active, options] = await Promise.all([getActiveRecipe(db), recipeIngredientOptions(db)]);
  if (!active) redirect("/produccion/receta");

  return (
    <>
      <PageHeader
        title="Nueva versión de la receta"
        description={`Copia editable de la versión ${active.version} activa. Al guardarla queda como borrador hasta que la actives.`}
      />
      <RecipeVersionForm
        options={options}
        baseVersion={active.version}
        initial={{
          expectedYieldPerKgStarch: active.expectedYieldPerKgStarch,
          deviationThresholdPct: active.deviationThresholdPct,
          notes: "",
          activate: false,
          items: active.items.map((i) => ({
            ingredientId: i.ingredientId,
            qtyPerKgStarch: i.qtyPerKgStarch,
            minPerKgStarch: i.minPerKgStarch ?? "",
            maxPerKgStarch: i.maxPerKgStarch ?? "",
            instructions: i.instructions ?? "",
          })),
        }}
      />
    </>
  );
}
