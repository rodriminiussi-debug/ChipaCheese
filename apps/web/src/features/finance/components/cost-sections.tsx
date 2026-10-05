import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, Info } from "lucide-react";
import { Kg, Money, Num } from "@/components/app/format";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { isCheese } from "../labels";
import type { CostOverview } from "../service";

/** Cifras principales del costeo (Regla 8), con el último precio de compra y el rendimiento real. */
export function CostHeadline({ overview }: { overview: CostOverview }) {
  const { costs } = overview;
  const y = costs.yield;
  const bag =
    costs.products.find((p) => p.kind === "manufactured" && p.netWeightKg === 0.5 && p.unitCost != null) ??
    null;
  return (
    <section aria-label="Costo directo" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        title="Costo directo por kg"
        value={costs.costPerKg != null ? <Money value={costs.costPerKg} /> : "Precio faltante"}
        tone={costs.costPerKg == null ? "warn" : "default"}
        hint={
          costs.costPerKg == null
            ? `Falta el precio de: ${costs.missingPrices.join(", ")}`
            : "Ingredientes + mano de obra ÷ kg realmente pesados"
        }
        testId="stat-cost-kg"
      />
      <StatCard
        title={
          bag ? `Costo por bolsa de ${bag.netWeightKg.toString().replace(".", ",")} kg` : "Costo por bolsa"
        }
        value={bag?.unitCost != null ? <Money value={bag.unitCost} /> : "—"}
        hint="Masa + envase y etiqueta"
        testId="stat-cost-bag"
      />
      <StatCard
        title="Rendimiento real"
        value={<Kg value={costs.producedKgPerRun} />}
        hint={
          y.source === "real" ? (
            <>
              por producción de {costs.starchKgPerRun} kg de fécula (promedio de {y.runs} producción(es) de
              los últimos {y.windowDays} días)
            </>
          ) : (
            `por producción, según la receta v${costs.recipe.version} (todavía no hay pesadas en ${y.windowDays} días)`
          )
        }
      />
      <StatCard
        title="Mano de obra por kg"
        value={<Money value={costs.labor.perKg} />}
        hint={
          <>
            {costs.labor.workers} personas × {costs.labor.hoursPerRun} h ×{" "}
            <Money value={costs.labor.hourlyCost} />
          </>
        }
      />
    </section>
  );
}

/** Alerta de precios faltantes: sin precio no hay costo (no se asume $0, error 8 del Excel). */
export function MissingPricesAlert({ overview }: { overview: CostOverview }) {
  const { costs } = overview;
  const blocked = costs.products.filter((p) => p.missingPrices.length > 0);
  if (blocked.length === 0 && costs.missingPrices.length === 0) return null;
  const names = [...new Set(blocked.flatMap((p) => p.missingPrices))];
  return (
    <Alert variant="destructive" className="border-amber-500/50">
      <AlertTriangle />
      <AlertTitle>Faltan precios de compra</AlertTitle>
      <AlertDescription>
        <p>
          Sin precio de {names.join(", ")} no se puede costear {blocked.map((p) => p.name).join(", ")}. El
          sistema no asume $0 (el Excel lo hacía con el jamón y el queso del sándwich). Cargá una compra en{" "}
          <Link href={"/compras" as Route} className="underline">
            Compras
          </Link>
          .
        </p>
      </AlertDescription>
    </Alert>
  );
}

/** Desglose del costo por insumo con % del costo de ingredientes; marca lo que pesan los lácteos. */
export function IngredientBreakdown({ overview }: { overview: CostOverview }) {
  const { costs } = overview;
  const run = costs.starchKgPerRun;
  return (
    <section aria-labelledby="breakdown-title" className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="breakdown-title" className="text-lg font-semibold">
          Desglose por insumo
        </h2>
        {overview.dairyPctOfIngredients != null ? (
          <div className="flex max-w-full min-w-0 flex-wrap gap-2 text-sm">
            <StatusBadge tone="info" className="h-auto max-w-full py-0.5 text-left whitespace-normal">
              Lácteos (quesos, manteca y leche):{" "}
              <Num value={overview.dairyPctOfIngredients} decimals={1} suffix="%" /> de los ingredientes
            </StatusBadge>
            <StatusBadge tone="neutral">
              Quesos: <Num value={overview.cheesePctOfIngredients} decimals={1} suffix="%" />
            </StatusBadge>
          </div>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table aria-label="Desglose del costo por insumo">
          <TableHeader>
            <TableRow>
              <TableHead>Insumo</TableHead>
              <TableHead className="text-right">Por producción</TableHead>
              <TableHead className="text-right">Último precio sin IVA</TableHead>
              <TableHead className="text-right">Costo por producción</TableHead>
              <TableHead className="text-right">% de ingredientes</TableHead>
              <TableHead className="text-right">Por kg de producto</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {costs.ingredients.map((l) => (
              <TableRow key={l.ingredientId}>
                <TableCell className="font-medium">
                  {l.name}
                  {isCheese(l.name) ? <span className="text-muted-foreground"> · queso</span> : null}
                </TableCell>
                <TableCell className="text-right">
                  <Num value={l.qtyPerKgStarch * run} decimals={2} suffix={UNIT[l.unit]} />
                </TableCell>
                <TableCell className="text-right">
                  {l.unitPriceNet != null ? (
                    <Money value={l.unitPriceNet} />
                  ) : (
                    <StatusBadge tone="warn">Precio faltante</StatusBadge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Money value={l.costPerRun} />
                </TableCell>
                <TableCell className="text-right">
                  <Num value={l.pctOfIngredients} decimals={1} suffix="%" />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={l.costPerKgProduct} />
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-medium">Mano de obra</TableCell>
              <TableCell className="text-right">
                <Num value={costs.labor.workers * costs.labor.hoursPerRun} decimals={0} suffix="h" />
              </TableCell>
              <TableCell className="text-right">
                <Money value={costs.labor.hourlyCost} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={costs.labor.costPerRun} />
              </TableCell>
              <TableCell />
              <TableCell className="text-right">
                <Money value={costs.labor.perKg} />
              </TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">Costo directo</TableCell>
              <TableCell />
              <TableCell />
              <TableCell className="text-right font-medium">
                <Money
                  value={
                    overview.ingredientsCostPerRun != null
                      ? overview.ingredientsCostPerRun + costs.labor.costPerRun
                      : null
                  }
                />
              </TableCell>
              <TableCell />
              <TableCell className="text-right font-medium">
                <Money value={costs.costPerKg} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </section>
  );
}

/** Costo por unidad de venta de cada producto, con el componente (envase, jamón…) y el precio faltante marcado. */
export function ProductCostTable({ overview }: { overview: CostOverview }) {
  const { costs } = overview;
  return (
    <section aria-labelledby="products-title" className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <h2 id="products-title" className="text-lg font-semibold">
        Costo por bolsa y por producto
      </h2>
      <div className="overflow-x-auto rounded-lg border">
        <Table aria-label="Costo por producto">
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Masa / base / compra</TableHead>
              <TableHead className="text-right">Envase y componentes</TableHead>
              <TableHead className="text-right">Costo directo por unidad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {costs.products.map((p) => (
              <TableRow key={p.productId}>
                <TableCell>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-muted-foreground text-xs">
                    {p.kind === "resale" ? (
                      "Reventa · último costo de compra"
                    ) : p.kind === "prepared" ? (
                      <>
                        Elaborado · <Num value={p.baseQty ?? 0} decimals={2} /> ×{" "}
                        {p.baseName ?? "producto base"}
                      </>
                    ) : (
                      <Num value={p.netWeightKg} decimals={p.netWeightKg < 1 ? 2 : 0} suffix="kg netos" />
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {p.kind === "manufactured" ? <Money value={p.doughCost} /> : <Money value={p.baseCost} />}
                </TableCell>
                <TableCell className="text-right">
                  <Money value={p.componentsCost} />
                  {p.components.some((c) => c.cost == null) ? (
                    <div className="text-xs text-amber-700 dark:text-amber-400">
                      sin precio:{" "}
                      {p.components
                        .filter((c) => c.cost == null)
                        .map((c) => c.name)
                        .join(", ")}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {p.unitCost != null ? (
                    <Money value={p.unitCost} />
                  ) : (
                    <StatusBadge tone="warn">Precio faltante</StatusBadge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

/** Nota explicativa: lo que el Excel calculaba mal (error 1 del relevamiento: rendimiento inflado). */
export function ExcelNote({ overview }: { overview: CostOverview }) {
  const { excel } = overview;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Info className="size-4" /> Qué calculaba mal el Excel
        </CardTitle>
        <CardDescription>Por qué este costo no coincide con el de la planilla de costos.</CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground grid gap-2 text-sm">
        <p>
          El Excel dividía el costo de los ingredientes por{" "}
          <strong className="text-foreground">163,5 kg</strong>, que es la suma de lo que entra a la batidora,
          no lo que sale pesado. Acá se divide por los{" "}
          <strong className="text-foreground">
            <Kg value={excel.realKg} />
          </strong>{" "}
          realmente pesados por producción.
        </p>
        {excel.ingredientsPerKgExcel != null && excel.ingredientsPerKgReal != null ? (
          <p>
            Ingredientes por kg: <Money value={excel.ingredientsPerKgExcel} /> en el Excel contra{" "}
            <Money value={excel.ingredientsPerKgReal} /> reales
            {excel.underestimatedPct != null ? (
              <>
                {" "}
                (el Excel quedaba <Num value={excel.underestimatedPct} decimals={1} suffix="%" /> abajo)
              </>
            ) : null}
            .
          </p>
        ) : null}
        <p>
          También se corrigió: el envase ahora suma al costo de la bolsa, la receta sale de la receta maestra
          de la planta (no de una pestaña vieja) y el sándwich no asume jamón ni queso en $0: muestra
          &quot;precio faltante&quot;.
        </p>
      </CardContent>
    </Card>
  );
}
