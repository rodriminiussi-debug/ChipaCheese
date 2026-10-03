import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { parseDecimalAR } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { PrintButton, PrintStyles } from "@/features/production/components/print";
import { RecipeSheet } from "@/features/production/components/recipe-sheet";
import { fmtQty } from "@/features/production/format";
import { getActiveRecipe, getRecipe } from "@/features/production/service";

export const metadata = { title: "Ficha de receta" };

const PRESETS = [75, 37.5];

/** Ficha imprimible escalada a X kg de fécula (75 = receta completa, 37,5 = una tanda). */
export default async function RecipeSheetPage(props: PageProps<"/produccion/receta/ficha">) {
  await requirePermission("production:read");
  const { kg, v } = await props.searchParams;
  const parsed = typeof kg === "string" ? parseDecimalAR(kg) : null;
  const starchKg = parsed && parsed > 0 && parsed <= 300 ? parsed : 75;
  const recipe = typeof v === "string" ? await getRecipe(db, v) : await getActiveRecipe(db);
  if (!recipe) notFound();

  return (
    <>
      <PrintStyles pageSize="A4" margin="12mm" />
      <div className="print:hidden">
        <PageHeader
          title="Ficha de receta"
          description="Se imprime en A4 con las cantidades para la fécula elegida, columnas para anotar lote y real, y firmas."
          actions={
            <>
              <Button variant="outline" asChild>
                <Link href={`/produccion/receta?v=${recipe.id}`}>
                  <ArrowLeft /> Volver a la receta
                </Link>
              </Button>
              <PrintButton label="Imprimir ficha" />
            </>
          }
        />
        <div className="mb-6 flex flex-wrap items-end gap-3">
          <div className="flex gap-2" role="group" aria-label="Cantidades habituales">
            {PRESETS.map((p) => (
              <Button key={p} variant={p === starchKg ? "default" : "outline"} asChild>
                <Link href={`/produccion/receta/ficha?kg=${p}&v=${recipe.id}`}>
                  {fmtQty(p)} kg{p === 37.5 ? " (una tanda)" : " (receta completa)"}
                </Link>
              </Button>
            ))}
          </div>
          <form className="flex items-end gap-2" action="/produccion/receta/ficha">
            <input type="hidden" name="v" value={recipe.id} />
            <label className="grid gap-1 text-sm">
              Otra cantidad (kg de fécula)
              <Input name="kg" inputMode="decimal" defaultValue={fmtQty(starchKg)} className="w-32" />
            </label>
            <Button type="submit" variant="outline">
              Escalar
            </Button>
          </form>
        </div>
      </div>
      <div className="rounded-lg border p-2 print:border-0 print:p-0">
        <RecipeSheet recipe={recipe} starchKg={starchKg} />
      </div>
    </>
  );
}
