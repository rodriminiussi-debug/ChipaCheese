import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, ArrowRight, CheckCircle2, OctagonAlert } from "lucide-react";
import { Kg, Money, Num } from "@/components/app/format";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { monthLabel } from "@/features/finance/format";
import { CHANNEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { DashboardAlert, FinancialDashboard, OperationalDashboard } from "../service";

const pctTone = (v: number | null, good: number, warn: number): "default" | "good" | "warn" | "bad" =>
  v == null ? "default" : v >= good ? "good" : v >= warn ? "warn" : "bad";

/** Panel de alertas accionables: cada una lleva a la pantalla donde se resuelve. */
export function AlertsPanel({ alerts }: { alerts: DashboardAlert[] }) {
  return (
    <section aria-labelledby="alerts-title" className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <h2 id="alerts-title" className="text-lg font-semibold">
        Para atender
      </h2>
      {alerts.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border p-4 text-sm">
          <CheckCircle2 className="size-5 text-emerald-600" aria-hidden />
          Todo en orden: no hay alertas para atender.
        </div>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-2" aria-label="Alertas">
          {alerts.map((a) => (
            <li key={a.id}>
              <Link
                href={a.href as Route}
                className={cn(
                  "hover:bg-muted/50 flex items-start gap-3 rounded-lg border p-3 transition-colors",
                  a.severity === "bad" ? "border-destructive/40" : "border-amber-500/40",
                )}
              >
                {a.severity === "bad" ? (
                  <OctagonAlert className="text-destructive mt-0.5 size-5 shrink-0" aria-hidden />
                ) : (
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-medium">
                    {a.label}
                    {!(a.financial && a.id === "receivables-overdue") ? (
                      <StatusBadge tone={a.severity === "bad" ? "bad" : "warn"}>{a.count}</StatusBadge>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">{a.detail}</span>
                </span>
                <ArrowRight className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Indicadores operativos de la tabla "Indicadores" del relevamiento (sin montos). */
export function OperationalKpis({ op }: { op: OperationalDashboard }) {
  const cap = op.capacity;
  return (
    <section aria-labelledby="kpi-op-title" className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <h2 id="kpi-op-title" className="text-lg font-semibold">
        Planta y operación
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          title="Uso de capacidad (semana)"
          testId="kpi-capacity"
          value={<Num value={cap.usagePct} decimals={1} suffix="%" />}
          tone={pctTone(cap.usagePct, 90, 60)}
          hint={
            <>
              <Kg value={cap.producedKg} /> en {cap.workdays} día(s) hábil(es) · tope {cap.capacityKg} kg/día
            </>
          }
        />
        <StatCard
          title="Rendimiento promedio"
          testId="kpi-yield"
          value={<Num value={op.yield.ratio != null ? op.yield.ratio * 100 : null} decimals={1} suffix="%" />}
          hint={
            op.yield.runs > 0 ? (
              <>
                kg pesados ÷ kg de ingredientes · {op.yield.runs} producción(es) de los últimos{" "}
                {op.yield.windowDays} días
              </>
            ) : (
              `Sin producciones con pesadas y consumos en ${op.yield.windowDays} días`
            )
          }
        />
        <StatCard
          title="Entregas a tiempo y completas"
          testId="kpi-otif"
          value={<Num value={op.otif.pct} decimals={1} suffix="%" />}
          tone={pctTone(op.otif.pct, 95, 80)}
          hint={
            op.otif.delivered > 0
              ? `${op.otif.ok} de ${op.otif.delivered} pedidos entregados en ${monthLabel(op.otif.month)}`
              : `Sin entregas en ${monthLabel(op.otif.month)}`
          }
        />
        <StatCard
          title="Cobertura de materia prima"
          testId="kpi-coverage"
          value={`${op.coverage.belowReorderPoint} bajo punto de pedido`}
          tone={op.coverage.belowReorderPoint > 0 ? "warn" : "good"}
          hint={
            op.coverage.items.length > 0
              ? op.coverage.items.map((i) => i.name).join(", ")
              : `Los ${op.coverage.total} insumos están sobre el punto de pedido`
          }
        />
        <StatCard
          title="Registros BPM al día"
          testId="kpi-bpm"
          value={<Num value={op.bpm.cleaningCompliancePct} decimals={0} suffix="%" />}
          tone={pctTone(op.bpm.cleaningCompliancePct, 100, 80)}
          hint={`Limpieza del mes · ${op.bpm.missingTemperaturesToday} equipo(s) sin temperatura hoy`}
        />
        <StatCard
          title="Preventivos cumplidos"
          testId="kpi-preventive"
          value={<Num value={op.maintenance.preventiveCompliancePct} decimals={0} suffix="%" />}
          tone={pctTone(op.maintenance.preventiveCompliancePct, 100, 80)}
          hint={`${op.maintenance.overdue} vencido(s) · ${op.maintenance.dueSoon} por vencer`}
        />
      </div>
    </section>
  );
}

/** Indicadores con plata. Sólo se renderiza para quien tiene `finance:read`. */
export function FinancialKpis({ fin }: { fin: FinancialDashboard }) {
  return (
    <section aria-labelledby="kpi-fin-title" className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <h2 id="kpi-fin-title" className="text-lg font-semibold">
        Plata
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          title="Costo por bolsa de 0,5 kg"
          testId="kpi-cost-bag"
          value={fin.costPerBag ? <Money value={fin.costPerBag.cost} /> : "Precio faltante"}
          tone={fin.costPerBag ? "default" : "warn"}
          hint={
            <>
              {fin.costPerKg != null ? (
                <>
                  <Money value={fin.costPerKg} /> por kg ·{" "}
                </>
              ) : null}
              <Link href={"/costos" as Route} className="underline">
                Ver costos
              </Link>
            </>
          }
        />
        <StatCard
          title="Ventas netas del mes"
          testId="kpi-sales"
          value={<Money value={fin.salesNet} decimals={0} />}
          hint={
            <Link href={`/costos/resultado?mes=${fin.month}` as Route} className="underline">
              Ver el resultado
            </Link>
          }
        />
        <StatCard
          title="Deuda de clientes"
          testId="kpi-receivables"
          value={<Money value={fin.receivables.total} decimals={0} />}
          tone={fin.receivables.overdue > 0 ? "bad" : "default"}
          hint={
            <>
              Vencida: <Money value={fin.receivables.overdue} decimals={0} /> ·{" "}
              <Link href={"/cobranzas" as Route} className="underline">
                Cobranzas
              </Link>
            </>
          }
        />
        <StatCard
          title="Costo de reparto por kg"
          testId="kpi-delivery"
          value={fin.deliveryCostPerKg != null ? <Money value={fin.deliveryCostPerKg} /> : "—"}
          hint={
            fin.deliveryCostPerKg != null
              ? "Rutas del mes ÷ kg entregados"
              : "Sin rutas con entregas en el mes"
          }
        />
      </div>
    </section>
  );
}

/** Resultado del mes y si cubre los retiros (resumen; el detalle está en /costos/resultado). */
export function ResultSummary({ fin }: { fin: FinancialDashboard }) {
  const w = fin.result.withdrawals;
  return (
    <section aria-label="Resultado del mes" className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
      <StatCard
        title={`Resultado de ${monthLabel(fin.month)}`}
        testId="kpi-result"
        value={<Money value={fin.result.result} decimals={0} />}
        tone={fin.result.result < 0 ? "bad" : "good"}
        hint={
          <>
            {fin.result.resultPct != null ? (
              <>
                <Num value={fin.result.resultPct} decimals={1} suffix="%" /> de las ventas ·{" "}
              </>
            ) : null}
            <Link href={`/costos/resultado?mes=${fin.month}` as Route} className="underline">
              Cómo se calcula
            </Link>
          </>
        }
      />
      <StatCard
        title="¿Cubre los retiros de los socios?"
        testId="kpi-withdrawals"
        value={w.covers ? "Sí, cubre" : "No cubre"}
        tone={w.covers ? "good" : "bad"}
        hint={
          <>
            Retiros <Money value={w.amount} decimals={0} /> · {w.covers ? "sobran" : "faltan"}{" "}
            <Money value={Math.abs(w.difference)} decimals={0} />
          </>
        }
      />
    </section>
  );
}

/** Margen por canal: (precio − costo) ÷ precio de cada lista contra su margen objetivo. */
export function MarginByChannel({ fin }: { fin: FinancialDashboard }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Margen por canal</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table aria-label="Margen por canal">
            <TableHeader>
              <TableRow>
                <TableHead>Lista</TableHead>
                <TableHead className="text-right">Margen promedio</TableHead>
                <TableHead className="text-right">Objetivo</TableHead>
                <TableHead className="hidden text-right xl:table-cell">Bajo objetivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fin.marginByChannel.map((m) => (
                <TableRow key={m.listId}>
                  <TableCell>
                    <div className="font-medium">{m.listName}</div>
                    <div className="text-muted-foreground text-xs">{CHANNEL[m.channel] ?? m.channel}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    {m.avgMarginPct != null ? (
                      <span
                        className={cn(
                          "tabular-nums",
                          m.avgMarginPct < m.targetMarginPct && "text-amber-700 dark:text-amber-400",
                        )}
                      >
                        <Num value={m.avgMarginPct} decimals={1} suffix="%" />
                      </span>
                    ) : (
                      <StatusBadge tone="warn">Sin costo</StatusBadge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Num value={m.targetMarginPct} decimals={0} suffix="%" />
                  </TableCell>
                  <TableCell className="hidden text-right xl:table-cell">
                    {m.belowCost > 0 ? (
                      <StatusBadge tone="bad">{m.belowCost} bajo costo</StatusBadge>
                    ) : (
                      m.belowTarget
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function TopCustomers({ fin }: { fin: FinancialDashboard }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mejores clientes de {monthLabel(fin.month)}</CardTitle>
      </CardHeader>
      <CardContent>
        {fin.topCustomers.length === 0 ? (
          <p className="text-muted-foreground text-sm">Todavía no hay facturas en el mes.</p>
        ) : (
          <ol aria-label="Mejores clientes" className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {fin.topCustomers.map((c, i) => (
              <li key={c.customerId} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground mr-2 tabular-nums">{i + 1}.</span>
                  <Link href={`/cobranzas/clientes/${c.customerId}` as Route} className="hover:underline">
                    {c.name}
                  </Link>
                </span>
                <Money value={c.net} decimals={0} />
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
