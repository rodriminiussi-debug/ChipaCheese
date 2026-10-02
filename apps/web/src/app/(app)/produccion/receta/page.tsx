import Link from "next/link";
import { FilePlus2, Printer } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { DateText } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { can } from "@/lib/rbac";
import { ActivateRecipeButton } from "@/features/production/components/activate-recipe-button";
import { RecipeTable } from "@/features/production/components/recipe-table";
import { fmtQty } from "@/features/production/format";
import { RECIPE_STATUS } from "@/features/production/labels";
import { getActiveRecipe, getRecipe, listRecipeVersions } from "@/features/production/service";

export const metadata = { title: "Receta maestra" };

export default async function RecipePage(props: PageProps<"/produccion/receta">) {
  const user = await requirePermission("production:read");
  const { v } = await props.searchParams;
  const versionId = typeof v === "string" ? v : undefined;
  const [active, versions] = await Promise.all([getActiveRecipe(db), listRecipeVersions(db)]);
  const recipe = (versionId ? await getRecipe(db, versionId) : undefined) ?? active;
  const canWrite = can(user.role, "recipes:write");

  if (!recipe) {
    return (
      <>
        <PageHeader
          title="Receta maestra"
          description="RF-18 · Cantidades por kg de fécula, rangos y versiones."
        />
        <EmptyState
          title="Todavía no hay receta"
          description="Cargá la primera versión de la receta."
          action={
            canWrite ? (
              <Button asChild>
                <Link href="/produccion/receta/nueva">Nueva versión</Link>
              </Button>
            ) : null
          }
        />
      </>
    );
  }

  const status = RECIPE_STATUS[recipe.status]!;
  return (
    <>
      <PageHeader
        title="Receta maestra"
        description="RF-18 · Cantidades por kg de fécula, rangos aceptables y versiones. Una receta = 75 kg de fécula en dos tandas."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/produccion/receta/ficha?kg=75&v=${recipe.id}`}>
                <Printer /> Ficha imprimible
              </Link>
            </Button>
            {canWrite ? (
              <Button asChild>
                <Link href="/produccion/receta/nueva">
                  <FilePlus2 /> Nueva versión
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              {recipe.name} — versión {recipe.version}
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            </CardTitle>
            {canWrite && recipe.status !== "active" ? (
              <ActivateRecipeButton id={recipe.id} version={recipe.version} />
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Rendimiento esperado</dt>
                <dd className="font-medium">
                  {fmtQty(recipe.expectedYieldPerKgStarch)} kg de producto por kg de fécula
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Umbral de desvío del consumo</dt>
                <dd className="font-medium">{fmtQty(recipe.deviationThresholdPct)} %</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Vigente desde</dt>
                <dd className="font-medium">
                  <DateText value={recipe.effectiveFrom} />
                </dd>
              </div>
            </dl>
            {recipe.notes ? <p className="text-muted-foreground text-sm">{recipe.notes}</p> : null}
            <RecipeTable recipe={recipe} starchKg={75} />
          </CardContent>
        </Card>

        <section aria-labelledby="historial">
          <h2 id="historial" className="mb-2 text-lg font-semibold">
            Historial de versiones
          </h2>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Versión</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Vigente desde</TableHead>
                  <TableHead className="hidden md:table-cell">Notas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((r) => (
                  <TableRow key={r.id} data-state={r.id === recipe.id ? "selected" : undefined}>
                    <TableCell>
                      <Link href={`/produccion/receta?v=${r.id}`} className="font-medium hover:underline">
                        Versión {r.version}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={RECIPE_STATUS[r.status]!.tone}>
                        {RECIPE_STATUS[r.status]!.label}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      <DateText value={r.effectiveFrom} />
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden max-w-md truncate md:table-cell">
                      {r.notes ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </>
  );
}
