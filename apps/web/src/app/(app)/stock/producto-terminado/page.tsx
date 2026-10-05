import { DateText, Kg, Num } from "@/components/app/format";
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
import { TransferDialog, type TransferLotOption } from "@/features/stock/components/transfer-dialog";
import { EXPIRY_LEVEL } from "@/features/stock/labels";
import { getFinishedLotPositions, getProductStockMatrix } from "@/features/stock/service";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Stock · Producto terminado" };

export default async function FinishedStockPage() {
  const user = await requirePermission("stock:read");
  const [matrix, lots] = await Promise.all([getProductStockMatrix(db), getFinishedLotPositions(db)]);
  const canWrite = can(user.role, "stock:write");
  const below = matrix.rows.filter((r) => r.belowMin);

  const lotOptions: TransferLotOption[] = lots
    .filter((l) => l.finishedLotId)
    .map((l) => ({
      productId: l.productId,
      locationId: l.locationId,
      finishedLotId: l.finishedLotId!,
      label: `${l.lotCode} · vence ${l.expiryDate?.split("-").reverse().join("/")} · ${l.qty} u.`,
    }));

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Unidades en stock" value={<Num value={matrix.totalUnits} decimals={0} />} />
        <StatCard title="Kg de producto" value={<Kg value={matrix.totalKg} />} />
        <StatCard
          title="Bajo el mínimo"
          value={below.length}
          tone={below.length ? "warn" : "good"}
          hint={below.length ? below.map((r) => r.code).join(", ") : "Todos los productos cubren su mínimo"}
        />
      </div>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Producto × ubicación</h2>
          {canWrite ? (
            <TransferDialog
              products={matrix.rows
                .filter((r) => r.kind === "manufactured")
                .map((r) => ({ id: r.productId, name: r.name, code: r.code }))}
              locations={matrix.locations.map((l) => ({ id: l.id, code: l.code, name: l.name }))}
              lots={lotOptions}
            />
          ) : null}
        </div>
        <div className="rounded-lg border">
          <Table aria-label="Stock de producto terminado por ubicación">
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                {matrix.locations.map((l) => (
                  <TableHead key={l.id} className="text-right">
                    {l.code}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Mínimo</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrix.rows.map((r) => (
                <TableRow key={r.productId}>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-muted-foreground text-xs">{r.code}</div>
                  </TableCell>
                  {matrix.locations.map((l) => {
                    const units = r.byLocation[l.id] ?? 0;
                    return (
                      <TableCell key={l.id} className="text-right" data-location={l.code}>
                        {units ? (
                          <>
                            <div className="tabular-nums">
                              <Num value={units} decimals={0} />
                            </div>
                            <div className="text-muted-foreground text-xs">
                              <Kg value={units * r.netWeightKg} />
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right">
                    <div className="font-medium tabular-nums">
                      <Num value={r.totalUnits} decimals={0} />
                    </div>
                    <div className="text-muted-foreground text-xs">
                      <Kg value={r.totalKg} />
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    <Num value={r.minStockUnits} decimals={0} />
                  </TableCell>
                  <TableCell>
                    {r.belowMin ? (
                      <StatusBadge tone="warn">Bajo mínimo</StatusBadge>
                    ) : (
                      <StatusBadge tone="good">OK</StatusBadge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">Total</TableCell>
                {matrix.locations.map((l) => (
                  <TableCell key={l.id} className="text-right">
                    <div className="tabular-nums">
                      <Num value={matrix.totalsByLocation[l.id]?.units ?? 0} decimals={0} />
                    </div>
                    <div className="text-muted-foreground text-xs">
                      <Kg value={matrix.totalsByLocation[l.id]?.kg ?? 0} />
                    </div>
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium">
                  <Num value={matrix.totalUnits} decimals={0} />
                </TableCell>
                <TableCell className="hidden sm:table-cell" />
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Detalle por lote</h2>
        <div className="rounded-lg border">
          <Table aria-label="Detalle de producto terminado por lote">
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Lote</TableHead>
                <TableHead>Ubicación</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead className="text-right">Días restantes</TableHead>
                <TableHead className="text-right">Unidades</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lots.map((l) => (
                <TableRow key={`${l.productId}-${l.finishedLotId}-${l.locationId}`}>
                  <TableCell>{l.productName}</TableCell>
                  <TableCell className="font-medium">
                    {l.lotCode ?? "Sin lote"}
                    {l.onHold ? (
                      <StatusBadge tone="bad" className="ml-2">
                        Retenido
                      </StatusBadge>
                    ) : null}
                  </TableCell>
                  <TableCell>{l.locationCode}</TableCell>
                  <TableCell>
                    <DateText value={l.expiryDate} />
                  </TableCell>
                  <TableCell className="text-right">
                    {l.daysLeft == null ? (
                      "—"
                    ) : (
                      <StatusBadge tone={EXPIRY_LEVEL[l.expiryLevel]}>
                        {l.daysLeft < 0 ? "Vencido" : `${l.daysLeft} d`}
                      </StatusBadge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Num value={l.qty} decimals={0} />
                  </TableCell>
                </TableRow>
              ))}
              {lots.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground text-center">
                    No hay producto terminado en stock.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
