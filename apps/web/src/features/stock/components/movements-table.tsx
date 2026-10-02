import Link from "next/link";
import type { Route } from "next";
import { Num } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTimeAR } from "@/lib/dates";
import { UNIT } from "@/lib/labels";
import { MOVEMENT_TYPE, REF_TABLE } from "../labels";
import type { MovementRow } from "../service";

/** Libro mayor: fecha, tipo, ítem, lote, ubicación, cantidad con signo, usuario y documento origen. */
export function MovementsTable({ rows }: { rows: MovementRow[] }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Ítem</TableHead>
            <TableHead className="hidden md:table-cell">Lote</TableHead>
            <TableHead className="hidden sm:table-cell">Ubicación</TableHead>
            <TableHead className="text-right">Cantidad</TableHead>
            <TableHead className="hidden lg:table-cell">Usuario</TableHead>
            <TableHead className="hidden lg:table-cell">Documento</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const type = MOVEMENT_TYPE[r.type] ?? { label: r.type, tone: "neutral" as const };
            const ref = r.refTable ? (REF_TABLE[r.refTable] ?? { label: r.refTable }) : null;
            const href = ref && "href" in ref && ref.href && r.refId ? ref.href(r.refId) : null;
            return (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {formatDateTimeAR(r.occurredAt)}
                </TableCell>
                <TableCell>
                  <StatusBadge tone={type.tone}>{type.label}</StatusBadge>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{r.itemName}</div>
                  {r.note ? (
                    <div className="text-muted-foreground max-w-xs truncate text-xs">{r.note}</div>
                  ) : null}
                </TableCell>
                <TableCell className="hidden md:table-cell">{r.lotCode ?? "—"}</TableCell>
                <TableCell className="hidden sm:table-cell">{r.locationCode}</TableCell>
                <TableCell
                  className={`text-right font-medium tabular-nums ${r.qty < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`}
                >
                  {r.qty > 0 ? "+" : ""}
                  <Num value={r.qty} decimals={r.unit === "unit" ? 0 : 2} suffix={UNIT[r.unit]} />
                </TableCell>
                <TableCell className="hidden lg:table-cell">{r.userName ?? "Sistema"}</TableCell>
                <TableCell className="hidden lg:table-cell">
                  {ref ? (
                    href ? (
                      <Link href={href as Route} className="hover:underline">
                        {ref.label}
                      </Link>
                    ) : (
                      ref.label
                    )
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
