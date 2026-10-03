import { Kg, Money, Num } from "@/components/app/format";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UNIT } from "@/lib/labels";
import type { ProductCosts } from "../service";

/** Resumen del costeo (Regla 8): costo por kg, rendimiento usado, mano de obra y desglose por insumo. */
export function CostSummary({ costs }: { costs: ProductCosts }) {
  const y = costs.yield;
  return (
    <section aria-label="Costo directo" className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          title="Costo directo por kg"
          value={costs.costPerKg != null ? <Money value={costs.costPerKg} /> : "Precio faltante"}
          tone={costs.costPerKg == null ? "warn" : "default"}
          hint={
            costs.costPerKg == null
              ? `Falta el precio de: ${costs.missingPrices.join(", ")}`
              : "Ingredientes + mano de obra, sobre kg reales"
          }
        />
        <StatCard
          title="Rendimiento usado"
          value={<Num value={y.perKgStarch} decimals={3} suffix="kg/kg fécula" />}
          hint={
            y.source === "real" ? (
              <>
                Real: <Kg value={y.weighedKg} /> pesados en {y.runs} producción(es) de los últimos{" "}
                {y.windowDays} días
              </>
            ) : (
              `De la receta v${costs.recipe.version} (no hay producciones en ${y.windowDays} días)`
            )
          }
        />
        <StatCard
          title="Kg por producción"
          value={<Kg value={costs.producedKgPerRun} />}
          hint={`${costs.starchKgPerRun} kg de fécula × rendimiento`}
        />
        <StatCard
          title="Mano de obra por kg"
          value={<Money value={costs.labor.perKg} />}
          hint={
            <>
              {costs.labor.workers} personas × {costs.labor.hoursPerRun} h ×{" "}
              <Money value={costs.labor.hourlyCost} /> = <Money value={costs.labor.costPerRun} />
            </>
          }
        />
      </div>

      <details className="rounded-lg border">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Desglose del costo por insumo
        </summary>
        <div className="overflow-x-auto px-2 pb-2">
          <Table aria-label="Desglose del costo por insumo">
            <TableHeader>
              <TableRow>
                <TableHead>Insumo</TableHead>
                <TableHead className="text-right">Por kg de fécula</TableHead>
                <TableHead className="text-right">Último precio sin IVA</TableHead>
                <TableHead className="text-right">Costo por kg de producto</TableHead>
                <TableHead className="text-right">% ingredientes</TableHead>
                <TableHead className="text-right">% del costo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {costs.ingredients.map((l) => (
                <TableRow key={l.ingredientId}>
                  <TableCell>{l.name}</TableCell>
                  <TableCell className="text-right">
                    <Num value={l.qtyPerKgStarch} decimals={3} suffix={UNIT[l.unit]} />
                  </TableCell>
                  <TableCell className="text-right">
                    {l.unitPriceNet != null ? (
                      <Money value={l.unitPriceNet} />
                    ) : (
                      <StatusBadge tone="warn">Precio faltante</StatusBadge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={l.costPerKgProduct} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Num value={l.pctOfIngredients} decimals={1} suffix="%" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Num value={l.pctOfCost} decimals={1} suffix="%" />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell>Mano de obra</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right">
                  <Money value={costs.labor.perKg} />
                </TableCell>
                <TableCell />
                <TableCell className="text-right">
                  {costs.costPerKg != null ? (
                    <Num value={(costs.labor.perKg / costs.costPerKg) * 100} decimals={1} suffix="%" />
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">Costo directo por kg</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right font-medium">
                  <Money value={costs.costPerKg} />
                </TableCell>
                <TableCell />
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </details>
    </section>
  );
}
