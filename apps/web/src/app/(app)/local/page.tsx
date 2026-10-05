import { PageHeader } from "@/components/app/page-header";
import { DateText, Money, Num } from "@/components/app/format";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CashClosingForm } from "@/features/store/components/cash-closing";
import { MerchandiseForm } from "@/features/store/components/merchandise-form";
import { ReplenishmentList } from "@/features/store/components/replenishment-list";
import { StockAlertsPanel } from "@/features/store/components/stock-alerts-panel";
import { StorePos } from "@/features/store/components/store-pos";
import { VoidSaleButton } from "@/features/store/components/void-sale-button";
import { getPreparedAvailability, getStoreStockAlerts } from "@/features/store/alerts";
import { STORE_METHOD_LABEL, STORE_STATUS } from "@/features/store/labels";
import { listReplenishments } from "@/features/store/replenishment";
import {
  getDaySummary,
  getMonthSummary,
  getStoreCatalog,
  getStoreCustomers,
  getStoreStock,
  listResaleProducts,
  listStoreSuppliers,
} from "@/features/store/service";
import { EXPIRY_LEVEL } from "@/features/stock/labels";
import { formatTimeAR, todayAR } from "@/lib/dates";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Local" };

/**
 * RF-33: el día a día del local. Alertas de stock por demanda y pedido de reposición, venta (chipá, reventa y
 * elaborados) con lector de código de barras y cuatro medios de pago, anulación de ventas, ingreso de
 * mercadería de reventa, stock con días de cobertura y cierre de caja por medio de pago.
 */
export default async function StorePage() {
  const user = await requirePermission("store:read");
  const canSell = can(user.role, "store:write");
  const isDirector = user.role === "admin";
  const today = todayAR();
  const [catalog, customers, stock, day, month, alerts, prepared, replenishments, resale, suppliers] =
    await Promise.all([
      getStoreCatalog(db, today),
      canSell ? getStoreCustomers(db, today) : Promise.resolve([]),
      getStoreStock(db, today),
      getDaySummary(db, today),
      getMonthSummary(db, today.slice(0, 7)),
      getStoreStockAlerts(db, today),
      getPreparedAvailability(db),
      listReplenishments(db, { limit: 15 }),
      canSell ? listResaleProducts(db) : Promise.resolve([]),
      canSell ? listStoreSuppliers(db) : Promise.resolve([]),
    ]);
  const caja = day.totals.byMethod;
  const openRequests = replenishments.filter((r) => r.status === "requested" || r.status === "sent").length;

  return (
    <>
      <PageHeader
        title="Local"
        description="Alertas de stock, ventas del mostrador, reposición, mercadería y cierre de caja (RF-33)."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          title="Vendido hoy"
          value={<Money value={day.totals.total} />}
          hint={`${day.totals.count} venta(s) · ${day.totals.units} u.`}
          testId="stat-today"
        />
        <StatCard title="Efectivo de hoy" value={<Money value={caja.cash} />} />
        <StatCard title="Transferencias de hoy" value={<Money value={caja.transfer} />} />
        <StatCard title="Tarjeta de hoy" value={<Money value={caja.card} />} />
        <StatCard title="QR / billetera de hoy" value={<Money value={caja.qr} />} />
        <StatCard
          title="Vendido en el mes"
          value={<Money value={month.totals.total} />}
          hint={`${month.totals.count} venta(s)`}
        />
      </div>

      <StockAlertsPanel alerts={alerts} canRequest={canSell} />

      <Tabs defaultValue={canSell ? "vender" : "ventas"} className="min-w-0">
        <TabsList className="h-auto flex-wrap">
          {canSell ? <TabsTrigger value="vender">Vender</TabsTrigger> : null}
          <TabsTrigger value="ventas">Ventas</TabsTrigger>
          <TabsTrigger value="reposicion">
            Reposición{openRequests > 0 ? ` (${openRequests})` : ""}
          </TabsTrigger>
          {canSell ? <TabsTrigger value="mercaderia">Mercadería</TabsTrigger> : null}
          <TabsTrigger value="caja">Cierre de caja</TabsTrigger>
          <TabsTrigger value="stock">Stock del local</TabsTrigger>
        </TabsList>

        {canSell ? (
          <TabsContent value="vender" className="mt-4">
            <StorePos products={catalog.products} poolStock={catalog.poolStock} customers={customers} />
          </TabsContent>
        ) : null}

        <TabsContent value="ventas" className="mt-4 grid min-w-0 gap-8 [&>*]:min-w-0">
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
                    {canSell ? <TableHead className="w-24" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {day.sales.map((s) => {
                    const byProduct = new Map<string, number>();
                    for (const i of s.items)
                      byProduct.set(i.product.name, (byProduct.get(i.product.name) ?? 0) + i.qtyUnits);
                    const voided = !!s.voidedAt;
                    const summary = `${[...byProduct].map(([n, q]) => `${q} × ${n}`).join(", ")} (${formatTimeAR(s.soldAt)})`;
                    const canVoid = canSell && !voided && (isDirector || !day.closing);
                    return (
                      <TableRow key={s.id} data-voided={voided || undefined} className={voided ? "opacity-70" : ""}>
                        <TableCell className="tabular-nums">{formatTimeAR(s.soldAt)}</TableCell>
                        <TableCell>
                          <div className={voided ? "line-through" : ""}>
                            {[...byProduct].map(([name, qty]) => (
                              <div key={name}>
                                {qty} × {name}
                              </div>
                            ))}
                          </div>
                          {s.customer ? (
                            <div className="text-muted-foreground text-xs">
                              Cliente: {s.customer.tradeName ?? s.customer.legalName}
                            </div>
                          ) : null}
                          {voided ? (
                            <div className="text-xs">
                              <StatusBadge tone="bad">Anulada</StatusBadge>{" "}
                              <span className="text-muted-foreground">
                                {s.voidReason}
                                {s.voidedBy ? ` · ${s.voidedBy.name}` : ""}
                              </span>
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {s.payments.length > 1
                            ? s.payments.map((p) => (
                                <div key={p.id} className="whitespace-nowrap">
                                  {STORE_METHOD_LABEL[p.method] ?? p.method} <Money value={p.amount} />
                                </div>
                              ))
                            : (STORE_METHOD_LABEL[s.method] ?? s.method)}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{s.seller?.name ?? "—"}</TableCell>
                        <TableCell className={`text-right font-medium ${voided ? "line-through" : ""}`}>
                          <Money value={s.total} />
                        </TableCell>
                        {canSell ? (
                          <TableCell className="text-right">
                            {canVoid ? <VoidSaleButton saleId={s.id} summary={summary} /> : null}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                  {day.sales.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={canSell ? 6 : 5} className="text-muted-foreground text-center">
                        Todavía no hay ventas hoy.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
            {day.closing && canSell && !isDirector ? (
              <p className="text-muted-foreground mt-2 text-xs">
                La caja de hoy está cerrada: las ventas solo las puede anular Dirección.
              </p>
            ) : null}
          </section>

          <section aria-label="Ventas del mes">
            <h2 className="mb-2 text-lg font-semibold">Ventas del mes</h2>
            <div className="rounded-lg border">
              <Table aria-label="Ventas por día del mes">
                <TableHeader>
                  <TableRow>
                    <TableHead>Día</TableHead>
                    <TableHead className="text-right">Ventas</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Efectivo</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Transf.</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Tarjeta</TableHead>
                    <TableHead className="hidden text-right md:table-cell">QR</TableHead>
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
                      <TableCell className="hidden text-right md:table-cell">
                        <Money value={d.byMethod.cash} />
                      </TableCell>
                      <TableCell className="hidden text-right md:table-cell">
                        <Money value={d.byMethod.transfer} />
                      </TableCell>
                      <TableCell className="hidden text-right md:table-cell">
                        <Money value={d.byMethod.card} />
                      </TableCell>
                      <TableCell className="hidden text-right md:table-cell">
                        <Money value={d.byMethod.qr} />
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
                      <TableCell colSpan={8} className="text-muted-foreground text-center">
                        Sin ventas en el mes.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="reposicion" className="mt-4 min-w-0">
          <ReplenishmentList rows={replenishments} canAct={canSell} />
        </TabsContent>

        {canSell ? (
          <TabsContent value="mercaderia" className="mt-4 grid gap-3">
            <div>
              <h2 className="text-lg font-semibold">Ingreso de mercadería de reventa</h2>
              <p className="text-muted-foreground text-sm">
                Gaseosas, aguas y todo lo que trae el proveedor al local: suma al stock del local.
              </p>
            </div>
            <MerchandiseForm products={resale} suppliers={suppliers} />
          </TabsContent>
        ) : null}

        <TabsContent value="caja" className="mt-4 grid min-w-0 gap-4 [&>*]:min-w-0">
          {day.closing ? (
            <section aria-label="Caja cerrada" className="grid max-w-md gap-3">
              <Alert>
                <AlertTitle>La caja de hoy está cerrada</AlertTitle>
                <AlertDescription>
                  Cerró {day.closing.closedBy?.name ?? "el equipo del local"}.
                  {day.closing.stale
                    ? " Hubo ventas o anulaciones después del cierre: revisá los totales."
                    : ""}
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
                <dt className="text-muted-foreground">Tarjeta</dt>
                <dd className="text-right tabular-nums">
                  <Money value={day.closing.expectedCard} />
                </dd>
                <dt className="text-muted-foreground">QR / billetera</dt>
                <dd className="text-right tabular-nums">
                  <Money value={day.closing.expectedQr} />
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
            <CashClosingForm expected={caja} />
          ) : (
            <p className="text-muted-foreground text-sm">La caja de hoy todavía no se cerró.</p>
          )}
        </TabsContent>

        <TabsContent value="stock" className="mt-4 grid min-w-0 gap-8 [&>*]:min-w-0">
          <section aria-label="Cobertura por producto" className="grid gap-2">
            <h2 className="text-lg font-semibold">Stock y días de cobertura</h2>
            <div className="rounded-lg border">
              <Table aria-label="Stock del local por producto">
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">En el local</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Venta diaria</TableHead>
                    <TableHead className="text-right">Días de stock</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.rows.map((r) => (
                    <TableRow key={r.productId}>
                      <TableCell>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-muted-foreground text-xs">
                          {r.fromPlant ? "Chipá de la planta" : "Reventa"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Num value={r.stock} decimals={0} />
                      </TableCell>
                      <TableCell className="hidden text-right sm:table-cell">
                        {r.status === "no_sales" ? "—" : <Num value={r.avgDaily} decimals={1} />}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.daysLeft == null ? "—" : <Num value={r.daysLeft} decimals={1} />}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={STORE_STATUS[r.status].tone}>{STORE_STATUS[r.status].label}</StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {prepared.map((p) => (
                    <TableRow key={p.productId}>
                      <TableCell>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-muted-foreground text-xs">
                          Elaborado con {p.baseName} ({p.baseQty} por {p.unitLabel})
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Num value={p.available} decimals={0} />
                      </TableCell>
                      <TableCell className="hidden text-right sm:table-cell">—</TableCell>
                      <TableCell className="text-right">—</TableCell>
                      <TableCell>
                        <StatusBadge tone="neutral">Se arma al vender</StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          <section aria-label="Stock por lote" className="grid gap-2">
            <h2 className="text-lg font-semibold">Stock por lote y vencimiento</h2>
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
                        No hay producto en el local. Pedí reposición a la planta desde las alertas.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </>
  );
}
