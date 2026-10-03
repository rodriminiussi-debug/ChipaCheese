import { AlertTriangle } from "lucide-react";
import { consumptionDeviation } from "@chipa/domain";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText } from "@/components/app/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtQty, UNIT_SHORT } from "../format";
import type { RunDetail } from "../service";

/** Consumos ya registrados: teórico vs real por insumo y lote, con los fuera de rango marcados. */
export function ConsumptionTable({ consumptions }: { consumptions: RunDetail["consumptions"] }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Insumo</TableHead>
            <TableHead>Lote</TableHead>
            <TableHead className="text-right">Teórico</TableHead>
            <TableHead className="text-right">Real</TableHead>
            <TableHead className="text-right">Desvío</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {consumptions.map((c) => {
            const unit = UNIT_SHORT[c.ingredient.unit] ?? "";
            const dev = consumptionDeviation(c.qtyTheoretical, c.qtyActual);
            return (
              <TableRow key={c.id} className={c.outOfRange ? "bg-amber-50 dark:bg-amber-950/30" : undefined}>
                <TableCell className="font-medium">{c.ingredient.name}</TableCell>
                <TableCell className="text-sm">
                  {c.rawLot ? (
                    <>
                      {c.rawLot.supplierLotCode ?? "s/lote"}
                      {c.rawLot.expiryDate ? (
                        <span className="text-muted-foreground block text-xs">
                          vence <DateText value={c.rawLot.expiryDate} />
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">Sin lote</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtQty(c.qtyTheoretical)} {unit}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {fmtQty(c.qtyActual)} {unit}
                </TableCell>
                <TableCell className="text-muted-foreground text-right tabular-nums">
                  {Number.isFinite(dev.pct) ? `${dev.diff > 0 ? "+" : ""}${fmtQty(dev.pct, 1)} %` : "—"}
                </TableCell>
                <TableCell>
                  {c.outOfRange ? (
                    <StatusBadge tone="warn" className="gap-1">
                      <AlertTriangle className="size-3.5" /> Fuera de rango
                    </StatusBadge>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
