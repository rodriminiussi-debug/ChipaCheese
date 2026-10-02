import { Money, Num } from "@/components/app/format";
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
import type { InventoryCountDetail } from "../inventory";

/** RF-15: reporte de diferencias (cantidad y valorizado con el último precio sin IVA para insumos). */
export function CountReport({ detail }: { detail: InventoryCountDetail }) {
  const rows = detail.items.filter((i) => i.countedQty != null);
  const withDiff = rows.filter((i) => i.diff !== 0);
  const isIngredient = detail.count.itemKind === "ingredient";
  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">Reporte de diferencias</h2>
      <div className="rounded-lg border">
        <Table aria-label="Reporte de diferencias de inventario">
          <TableHeader>
            <TableRow>
              <TableHead>Ítem</TableHead>
              <TableHead>Lote</TableHead>
              <TableHead>Ubicación</TableHead>
              <TableHead className="text-right">Sistema</TableHead>
              <TableHead className="text-right">Contado</TableHead>
              <TableHead className="text-right">Diferencia</TableHead>
              {isIngredient ? <TableHead className="text-right">Valorizado</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {withDiff.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-medium">{i.itemName}</TableCell>
                <TableCell>{i.lotCode ?? "Sin lote"}</TableCell>
                <TableCell>{i.locationCode}</TableCell>
                <TableCell className="text-right">
                  <Num value={i.systemQty} suffix={UNIT[i.unit]} />
                </TableCell>
                <TableCell className="text-right">
                  <Num value={i.countedQty} suffix={UNIT[i.unit]} />
                </TableCell>
                <TableCell
                  className={`text-right font-medium tabular-nums ${(i.diff ?? 0) < 0 ? "text-destructive" : "text-emerald-700"}`}
                >
                  {(i.diff ?? 0) > 0 ? "+" : ""}
                  <Num value={i.diff} suffix={UNIT[i.unit]} />
                </TableCell>
                {isIngredient ? (
                  <TableCell className="text-right">
                    <Money value={i.diffValue} />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
            {withDiff.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isIngredient ? 7 : 6} className="text-muted-foreground text-center">
                  No hay diferencias entre lo contado y el sistema.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
          {isIngredient && withDiff.length ? (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={6} className="font-medium">
                  Diferencia valorizada total
                </TableCell>
                <TableCell className="text-right font-medium">
                  <Money value={detail.summary.totalDiffValue} />
                </TableCell>
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </div>
      <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge tone="neutral">{detail.summary.counted} contadas</StatusBadge>
        <StatusBadge tone={withDiff.length ? "warn" : "good"}>{withDiff.length} con diferencia</StatusBadge>
        {detail.summary.pending ? (
          <StatusBadge tone="neutral">{detail.summary.pending} sin contar (no se ajustaron)</StatusBadge>
        ) : null}
        {isIngredient
          ? " Valorizado con el último precio de compra sin IVA; insumos sin precio no se valorizan."
          : null}
      </p>
    </section>
  );
}
