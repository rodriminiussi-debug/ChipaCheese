import { PageHeader } from "@/components/app/page-header";
import { NativeSelect } from "@/components/app/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { IngredientManager } from "@/features/catalog/components/ingredient-manager";
import { ingredientFormOptions, listIngredients } from "@/features/catalog/service";
import { INGREDIENT_CATEGORY } from "@/features/purchases/labels";

export const metadata = { title: "Catálogo · Insumos" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function IngredientsPage(props: PageProps<"/catalogo/insumos">) {
  await requirePermission("catalog:write");
  const sp = await props.searchParams;
  const q = first(sp.q)?.trim() || undefined;
  const cat = first(sp.categoria);
  const category = cat && cat in INGREDIENT_CATEGORY ? cat : undefined;
  const st = first(sp.estado);
  const status = st === "inactive" || st === "all" ? st : "active";
  const [rows, options] = await Promise.all([
    listIngredients(db, { q, category, status }),
    ingredientFormOptions(db),
  ]);
  return (
    <>
      <PageHeader
        title="Insumos"
        description="Materias primas y envases: unidad, stock mínimo y de seguridad, proveedor habitual y precio inicial."
      />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <Input
          name="q"
          placeholder="Buscar insumo…"
          defaultValue={q}
          aria-label="Buscar insumos"
          className="max-w-sm"
        />
        <div className="w-48">
          <NativeSelect name="categoria" defaultValue={category ?? ""} aria-label="Filtrar por categoría">
            <option value="">Todas las categorías</option>
            {Object.entries(INGREDIENT_CATEGORY).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="w-40">
          <NativeSelect name="estado" defaultValue={status} aria-label="Filtrar por estado">
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
            <option value="all">Todos</option>
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
      </form>
      <IngredientManager rows={rows} options={options} />
    </>
  );
}
