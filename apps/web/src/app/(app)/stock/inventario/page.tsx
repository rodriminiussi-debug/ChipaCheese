import Link from "next/link";
import type { Route } from "next";
import { EmptyState } from "@/components/app/empty-state";
import { DateText } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewCountButtons } from "@/features/stock/components/new-count-form";
import { listInventoryCounts } from "@/features/stock/inventory";
import { COUNT_STATUS, ITEM_KIND } from "@/features/stock/labels";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Stock · Inventario" };

export default async function InventoryListPage() {
  const user = await requirePermission("stock:read");
  const counts = await listInventoryCounts(db);

  return (
    <div className="grid gap-4">
      {can(user.role, "stock:write") ? <NewCountButtons /> : null}
      {counts.length === 0 ? (
        <EmptyState
          title="Todavía no hay inventarios"
          description="Un conteo se precarga con el saldo del sistema por lote y ubicación; al confirmar, las diferencias se ajustan solas."
        />
      ) : (
        <div className="rounded-lg border">
          <Table aria-label="Inventarios físicos">
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Contadas</TableHead>
                <TableHead className="text-right">Con diferencia</TableHead>
                <TableHead className="hidden sm:table-cell">Responsable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {counts.map((c) => {
                const st = COUNT_STATUS[c.status] ?? { label: c.status, tone: "neutral" as const };
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        href={`/stock/inventario/${c.id}` as Route}
                        className="font-medium hover:underline"
                      >
                        <DateText value={c.date} />
                      </Link>
                    </TableCell>
                    <TableCell>{ITEM_KIND[c.itemKind]}</TableCell>
                    <TableCell>
                      <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.counted} / {c.items}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.withDiff}</TableCell>
                    <TableCell className="hidden sm:table-cell">{c.countedBy?.name ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
