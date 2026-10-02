import { AlertTriangle } from "lucide-react";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { CoverageTable } from "@/features/stock/components/coverage-table";
import { getIngredientCoverage, nextExpiryByIngredient } from "@/features/stock/service";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Stock · Materia prima" };

export default async function RawMaterialPage() {
  await requirePermission("stock:read");
  const [rows, expiries] = await Promise.all([getIngredientCoverage(db), nextExpiryByIngredient(db)]);
  const toReorder = rows.filter((r) => r.status === "reorder" || r.status === "out_of_stock");
  const expiring = Object.values(expiries).filter((e) => e.level === "soon" || e.level === "expired");

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Insumos activos" value={rows.length} />
        <StatCard
          title="A reponer"
          value={toReorder.length}
          tone={toReorder.length ? "warn" : "good"}
          hint="Sin stock o en/bajo el punto de pedido"
          testId="stat-reorder"
        />
        <StatCard
          title="Lotes por vencer"
          value={expiring.length}
          tone={expiring.length ? "warn" : "good"}
          hint="Insumos con lote vencido o a 7 días o menos"
        />
      </div>

      {toReorder.length ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">Hay que reponer: {toReorder.map((r) => r.name).join(", ")}.</p>
            <p className="text-muted-foreground">
              Punto de pedido = consumo diario de los últimos 30 días × plazo de entrega del proveedor + stock
              de seguridad.
            </p>
          </div>
        </div>
      ) : null}

      {rows.length ? (
        <CoverageTable rows={rows} expiries={expiries} />
      ) : (
        <EmptyState title="No hay insumos cargados" />
      )}
      <p className="text-muted-foreground text-xs">
        Ordenado por urgencia: sin stock, a reponer, y luego menos días de cobertura primero.
      </p>
    </div>
  );
}
