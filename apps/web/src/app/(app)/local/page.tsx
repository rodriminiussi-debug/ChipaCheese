import { PageHeader } from "@/components/app/page-header";
import { DateText, Money, Num } from "@/components/app/format";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CashClosingForm } from "@/features/store/components/cash-closing";
import { StorePos } from "@/features/store/components/store-pos";
import { STORE_METHOD_LABEL } from "@/features/store/labels";
import { getDaySummary, getMonthSummary, getStoreCatalog, getStoreStock } from "@/features/store/service";
import { EXPIRY_LEVEL } from "@/features/stock/labels";
import { formatTimeAR, todayAR } from "@/lib/dates";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Local" };

/** RF-33: ventas del local (POS), stock del local, historial del día y del mes, y cierre de caja. */
export default async function StorePage() {
  const user = await requirePermission("store:read");
  const canSell = can(user.role, "store:write");
  const today = todayAR();
  const [catalog, stock, day, month] = await Promise.all([
    getStoreCatalog(db, today),
    getStoreStock(db, today),
    getDaySummary(db, today),
    getMonthSummary(db, today.slice(0, 7)),
  ]);

  return (
    <>
      <PageHeader
        title="Local"
        description="Ventas del mostrador, stock del local y cierre de caja (RF-33)."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          title="Vendido hoy"
          value={<Money value={day.totals.total} />}
          hint={`${day.totals.count} venta(s) · ${day.totals.units} u.`}
          testId="stat-today"
        />
        <StatCard title="Efectivo de hoy" value={<Money value={day.totals.cash} />} />
        <StatCard title="Transferencias de hoy" value={<Money value={day.totals.electronic} />} />
        <StatCard
          title="Vendido en el mes"
          value={<Money value={month.totals.total} />}
          hint={`${month.totals.count} venta(s)`}
        />
      </div>

      <Tabs defaultValue={canSell ? "vender" : "ventas"}>
        <TabsList className="h-auto flex-wrap">
          {canSell ? <TabsTrigger value="vender">Vender</TabsTrigger> : null}
          <TabsTrigger value="ventas">Ventas</TabsTrigger>
          <TabsTrigger value="caja">Cierre de caja</TabsTrigger>
          <TabsTrigger value="stock">Stock del local</TabsTrigger>
        </TabsList>

        {canSell ? (
          <TabsContent value="vender" className="mt-4">
            <StorePos products={catalog.products} />
          </TabsContent>
        ) : null}

        <TabsContent value="ventas" className="mt-4 grid gap-8">
          <section aria-label="Ventas de hoy">
            <h2 className="mb-2 text-lg font-semibold">Ventas de hoy</h2>
            <div className="rounded-lg border">
              <Table aria-label="Ventas de hoy">
                <TableHeader>
                  <TableRow>
                    <TableHead>Hora</TableHead>
                    <TableHead>Productos</TableHead>
                    <TableHead>Medio</TableHead>
                    <TableHead className="hidden sm:table-cell">Vendedor</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {day.sales.map((s) => {
                    const byProduct = new Map<string, number>();
                    for (const i of s.items)
                      byProduct.set(i.product.name, (byProduct.get(i.product.name) ?? 0) + i.qtyUnits);
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="tabular-nums">{formatTimeAR(s.soldAt)}</TableCell>
                        <TableCell>
                          {[...byProduct].map(([name, qty]) => (
                            <div key={name}>
                              {qty} × {name}
                            </div>
                          ))}
                        </TableCell>
                        <TableCell>{STORE_METHOD_LABEL[s.method] ?? s.method}</TableCell>
                        <TableCell className="hidden sm:table-cell">{s.seller?.name ?? "—"}</TableCell>
                        <TableCell className="text-right font-medium">
                          <Money value={s.total} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {day.sales.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground text-center">
                        Todavía no hay ventas hoy.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </section>

          <section aria-label="Ventas del mes">
            <h2 className="mb-2 text-lg font-semibold">Ventas del mes</h2>
            <div className="rounded-lg border">
              <Table aria-label="Ventas por día del mes">
                <TableHeader>
                  <TableRow>
                    <TableHead>Día</TableHead>
                    <TableHead className="text-right">Ventas</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Efectivo</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Transferencias</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Caja</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {month.days.map((d) => (
                    <TableRow key={d.date}>
                      <TableCell>
                        <DateText value={d.date} />
                      </TableCell>
                      <TableCell className="text-right">{d.count}</TableCell>
                      <TableCell className="hidden text-right sm:table-cell">
                        <Money value={d.cash} />
                      </TableCell>
                      <TableCell className="hidden text-right sm:table-cell">
                        <Money value={d.electronic} />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <Money value={d.total} />
                      </TableCell>
                      <TableCell>
                        {d.closed ? (
                          <StatusBadge tone={d.difference === 0 ? "good" : "warn"}>
                            {d.difference === 0 ? "Cerrada" : "Cerrada con diferencia"}
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="neutral">Abierta</StatusBadge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {month.days.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-muted-foreground text-center">
                        Sin ventas en el mes.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="caja" className="mt-4 grid gap-4">
          {day.closing ? (
            <section aria-label="Caja cerrada" className="grid max-w-md gap-3">
              <Alert>
                <AlertTitle>La caja de hoy está cerrada</AlertTitle>
                <AlertDescription>
                  Cerró {day.closing.closedBy?.name ?? "el equipo del local"}.
                  {day.closing.stale ? " Hubo ventas después del cierre: revisá los totales." : ""}
                </AlertDescription>
              </Alert>
              <dl className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm">
                <dt className="text-muted-foreground">Efectivo esperado</dt>
                <dd className="text-right tabular-nums">
                  <Money value={day.closing.expectedCash} />
                </dd>
                <dt className="text-muted-foreground">Efectivo contado</dt>
                <dd className="text-right tabular-nums">
                  <Money value={day.closing.countedCash} />
                </dd>
                <dt className="text-muted-foreground">Diferencia</dt>
                <dd className="text-right font-semibold tabular-nums" data-testid="closing-difference">
                  <Money value={day.closing.difference} />
                </dd>
                <dt className="text-muted-foreground">Transferencias</dt>
                <dd className="text-right tabular-nums">
                  <Money value={day.closing.expectedTransfer} />
                </dd>
                {day.closing.notes ? (
                  <>
                    <dt className="text-muted-foreground">Observaciones</dt>
                    <dd className="text-right">{day.closing.notes}</dd>
                  </>
                ) : null}
              </dl>
            </section>
          ) : canSell ? (
            <CashClosingForm expectedCash={day.totals.cash} expectedTransfer={day.totals.electronic} />
          ) : (
            <p className="text-muted-foreground text-sm">La caja de hoy todavía no se cerró.</p>
          )}
        </TabsContent>

        <TabsContent value="stock" className="mt-4">
          <div className="rounded-lg border">
            <Table aria-label="Stock del local por lote">
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead className="text-right">Unidades</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stock.map((s) => (
                  <TableRow key={`${s.productId}-${s.finishedLotId}`}>
                    <TableCell>{s.productName}</TableCell>
                    <TableCell>{s.lotCode ?? "Sin lote"}</TableCell>
                    <TableCell>
                      <DateText value={s.expiryDate} />{" "}
                      {s.daysLeft != null && s.expiryLevel !== "ok" ? (
                        <StatusBadge tone={EXPIRY_LEVEL[s.expiryLevel]}>
                          {s.daysLeft < 0 ? "Vencido" : `${s.daysLeft} d`}
                        </StatusBadge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <Num value={s.qty} decimals={0} />
                    </TableCell>
                  </TableRow>
                ))}
                {stock.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground text-center">
                      No hay producto en el local. Se carga con una transferencia desde F3 o F4 (Stock ›
                      Producto terminado).
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
