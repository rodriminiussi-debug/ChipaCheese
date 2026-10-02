import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DateText, Num } from "@/components/app/format";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  IngredientAdjustForm,
  type PositionOption,
} from "@/features/stock/components/ingredient-adjust-form";
import { IngredientLevelsForm } from "@/features/stock/components/ingredient-levels-form";
import { MovementsTable } from "@/features/stock/components/movements-table";
import { COVERAGE_STATUS, EXPIRY_LEVEL } from "@/features/stock/labels";
import { getIngredientStockDetail, listMovements, rawLocations } from "@/features/stock/service";
import { can } from "@/lib/rbac";
import { UNIT } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Stock · Insumo" };

export default async function IngredientStockPage(props: PageProps<"/stock/insumos/[id]">) {
  const user = await requirePermission("stock:read");
  const { id } = await props.params;
  const detail = await getIngredientStockDetail(db, id);
  if (!detail) notFound();
  const { ingredient, positions, total, coverage } = detail;
  const unit = UNIT[ingredient.unit] ?? ingredient.unit;
  const canWrite = can(user.role, "stock:write");
  const decimals = ingredient.unit === "unit" ? 0 : 2;

  const [movements, locations] = await Promise.all([
    listMovements(db, { ingredientId: id }, 1, 10),
    rawLocations(db),
  ]);

  // Posiciones sobre las que se puede ajustar: las que tienen saldo + "sin lote" por ubicación.
  const options: PositionOption[] = positions.map((p) => ({
    value: `${p.rawLotId ?? "none"}|${p.locationId}`,
    label: `${p.supplierLotCode ?? "Sin lote"} · ${p.locationCode} · ${p.qty} ${unit}`,
  }));
  for (const l of locations) {
    const value = `none|${l.id}`;
    if (!options.some((o) => o.value === value)) options.push({ value, label: `Sin lote · ${l.code}` });
  }

  const status = coverage ? COVERAGE_STATUS[coverage.status] : null;

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href="/stock"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> Materia prima
        </Link>
        <h2 className="mt-2 flex flex-wrap items-center gap-3 text-xl font-semibold">
          {ingredient.name}
          {status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : null}
        </h2>
        <p className="text-muted-foreground text-sm">
          {ingredient.defaultSupplier
            ? `Proveedor: ${ingredient.defaultSupplier.tradeName ?? ingredient.defaultSupplier.legalName} (entrega en ${ingredient.defaultSupplier.leadTimeDays} d)`
            : "Sin proveedor por defecto"}
          {ingredient.refrigerated ? " · Refrigerado" : ""}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Stock total" value={<Num value={total} decimals={decimals} suffix={unit} />} />
        <StatCard
          title="Cobertura"
          value={
            coverage?.coverageDays == null ? (
              "—"
            ) : (
              <Num value={coverage.coverageDays} decimals={1} suffix="días" />
            )
          }
          hint={
            coverage ? (
              <>
                Consumo <Num value={coverage.avgDailyConsumption} suffix={`${unit}/día`} /> (30 días)
              </>
            ) : null
          }
        />
        <StatCard
          title="Punto de pedido"
          value={coverage ? <Num value={coverage.reorderPoint} decimals={decimals} suffix={unit} /> : "—"}
          hint={coverage ? `${coverage.leadTimeDays} d de entrega + seguridad` : null}
        />
        <StatCard
          title="Mínimo / seguridad"
          value={
            <span className="text-lg">
              <Num value={ingredient.minStock} decimals={decimals} /> /{" "}
              <Num value={ingredient.safetyStock} decimals={decimals} /> {unit}
            </span>
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lotes y ubicaciones</CardTitle>
          <CardDescription>
            Saldo por lote del proveedor. Se alerta a 7 días o menos del vencimiento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {positions.length === 0 ? (
            <p className="text-muted-foreground text-sm">No hay stock de este insumo.</p>
          ) : (
            <div className="rounded-lg border">
              <Table aria-label="Lotes del insumo">
                <TableHeader>
                  <TableRow>
                    <TableHead>Lote proveedor</TableHead>
                    <TableHead className="hidden sm:table-cell">Proveedor</TableHead>
                    <TableHead>Ubicación</TableHead>
                    <TableHead>Vencimiento</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((p) => (
                    <TableRow key={`${p.rawLotId}-${p.locationId}`}>
                      <TableCell className="font-medium">{p.supplierLotCode ?? "Sin lote"}</TableCell>
                      <TableCell className="hidden sm:table-cell">{p.supplierName ?? "—"}</TableCell>
                      <TableCell>{p.locationName}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-2">
                          <DateText value={p.expiryDate} />
                          {p.expiryLevel === "soon" || p.expiryLevel === "expired" ? (
                            <StatusBadge tone={EXPIRY_LEVEL[p.expiryLevel]}>
                              {p.expiryLevel === "expired" ? "Vencido" : `${p.daysLeft} d`}
                            </StatusBadge>
                          ) : p.daysLeft != null ? (
                            <span className="text-muted-foreground text-xs">{p.daysLeft} d</span>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Num value={p.qty} decimals={decimals} suffix={unit} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {canWrite ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Ajuste manual</CardTitle>
              <CardDescription>Merma, descarte o corrección. El motivo es obligatorio.</CardDescription>
            </CardHeader>
            <CardContent>
              <IngredientAdjustForm ingredientId={ingredient.id} unit={unit} positions={options} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Niveles de reposición</CardTitle>
              <CardDescription>Stock mínimo y stock de seguridad del insumo.</CardDescription>
            </CardHeader>
            <CardContent>
              <IngredientLevelsForm
                ingredientId={ingredient.id}
                unit={unit}
                minStock={ingredient.minStock}
                safetyStock={ingredient.safetyStock}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}

      <section className="grid gap-3">
        <h3 className="text-lg font-semibold">Últimos movimientos</h3>
        {movements.rows.length ? (
          <MovementsTable rows={movements.rows} />
        ) : (
          <p className="text-muted-foreground text-sm">Sin movimientos.</p>
        )}
      </section>
    </div>
  );
}
