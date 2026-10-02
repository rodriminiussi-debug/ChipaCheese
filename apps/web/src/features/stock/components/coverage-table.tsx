import Link from "next/link";
import type { Route } from "next";
import { DateText, Num } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UNIT } from "@/lib/labels";
import { COVERAGE_STATUS, EXPIRY_LEVEL } from "../labels";
import type { ExpiryInfo, IngredientCoverage } from "../service";

/** RF-13 / RF-14: stock por insumo con cobertura, punto de pedido, estado y próximo vencimiento. */
export function CoverageTable({
  rows,
  expiries,
}: {
  rows: IngredientCoverage[];
  expiries: Record<string, ExpiryInfo>;
}) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Insumo</TableHead>
            <TableHead className="text-right">Stock</TableHead>
            <TableHead className="hidden text-right lg:table-cell">Mínimo</TableHead>
            <TableHead className="hidden text-right md:table-cell">Consumo diario</TableHead>
            <TableHead className="text-right">Cobertura</TableHead>
            <TableHead className="hidden text-right md:table-cell">Punto de pedido</TableHead>
            <TableHead className="hidden lg:table-cell">Próx. vencimiento</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const exp = expiries[r.ingredientId];
            const status = COVERAGE_STATUS[r.status];
            return (
              <TableRow key={r.ingredientId}>
                <TableCell>
                  <Link
                    href={`/stock/insumos/${r.ingredientId}` as Route}
                    className="font-medium hover:underline"
                  >
                    {r.name}
                  </Link>
                  <div className="text-muted-foreground text-xs">
                    {r.supplierName ? `${r.supplierName} · ${r.leadTimeDays} d de entrega` : "Sin proveedor"}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Num value={r.stock} decimals={r.unit === "unit" ? 0 : 2} suffix={UNIT[r.unit]} />
                </TableCell>
                <TableCell className="hidden text-right lg:table-cell">
                  <Num value={r.minStock} decimals={r.unit === "unit" ? 0 : 2} />
                </TableCell>
                <TableCell className="hidden text-right md:table-cell">
                  <Num value={r.avgDailyConsumption} decimals={2} suffix={`${UNIT[r.unit]}/día`} />
                </TableCell>
                <TableCell className="text-right">
                  {r.coverageDays == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <Num value={r.coverageDays} decimals={1} suffix="días" />
                  )}
                </TableCell>
                <TableCell className="hidden text-right md:table-cell">
                  <Num value={r.reorderPoint} decimals={r.unit === "unit" ? 0 : 2} />
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {exp?.expiryDate ? (
                    <span className="inline-flex items-center gap-2">
                      <DateText value={exp.expiryDate} />
                      {exp.level === "soon" || exp.level === "expired" ? (
                        <StatusBadge tone={EXPIRY_LEVEL[exp.level]}>
                          {exp.level === "expired" ? "Vencido" : `${exp.daysLeft} d`}
                        </StatusBadge>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
