import Link from "next/link";
import type { Route } from "next";
import { formatARS, formatKg, formatNumber } from "@chipa/domain";
import { ProductionPlot, ResultPlot } from "@/components/app/charts";
import {
  BarList,
  CHANNEL_COLOR,
  CHANNEL_ORDER,
  ChartCard,
  LegendItem,
  type BarRow,
} from "@/components/app/viz";
import { compactMoney, monthShort } from "@/features/finance/format";
import { CHANNEL } from "@/lib/labels";
import type { FinancialDashboard, OperationalDashboard } from "../service";
import {
  agingReading,
  capitalize,
  coverageReading,
  dayLabel,
  marginReading,
  monthName,
  monthlyValueReading,
  otifReading,
  productionReading,
  resultReading,
  salesReading,
  shortDate,
  storeReading,
  temperatureReading,
  topCustomersReading,
  yieldReading,
  zoneReading,
} from "../readings";
import { DailyUnitsPlot, OtifPlot, SalesStackPlot, TemperaturePlot, TrendPlot } from "./dashboard-charts";

/** Días de cobertura a los que llega la pista del gráfico de materia prima (más allá, la barra queda llena). */
const COVERAGE_CAP_DAYS = 60;
/** Meta de entregas a tiempo y completas (la misma que pinta de verde el indicador). */
const OTIF_TARGET = 95;

const ars0 = (n: number) => formatARS(n, { decimals: 0 });

/** Grupo temático de gráficos: un título y las tarjetas en 1 columna en el celular y 2 en pantallas anchas. */
function ChartGroup({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        {title}
      </h2>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">{children}</div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------
// Con montos (finance:read)
// ------------------------------------------------------------------------------------------------

function SalesCard({ fin }: { fin: FinancialDashboard }) {
  const c = fin.charts;
  const channels = CHANNEL_ORDER.filter((ch) => c.salesByMonth.some((m) => (m.byChannel[ch] ?? 0) !== 0));
  const data = c.salesByMonth.map((m) => ({ ...m, label: monthShort(m.month) }));
  return (
    <ChartCard
      id="sales"
      title="¿Cómo vienen las ventas?"
      reading={salesReading(c.salesByMonth)}
      legend={channels.map((ch) => (
        <LegendItem key={ch} color={CHANNEL_COLOR[ch]!} label={CHANNEL[ch] ?? ch} />
      ))}
      note="Ventas netas (sin IVA) por canal de los últimos 6 meses; las notas de crédito restan."
      table={{
        caption: "Ventas netas por canal y mes",
        head: ["Mes", ...channels.map((ch) => CHANNEL[ch] ?? ch), "Total"],
        rows: data.map((m) => [
          capitalize(monthName(m.month)),
          ...channels.map((ch) => ars0(m.byChannel[ch] ?? 0)),
          ars0(m.total),
        ]),
      }}
    >
      <SalesStackPlot data={data} />
    </ChartCard>
  );
}

function ResultCard({ fin }: { fin: FinancialDashboard }) {
  const c = fin.charts;
  const data = c.resultByMonth.map((m) => ({
    month: m.month,
    label: monthShort(m.month),
    result: m.hasData ? m.result : null,
    resultPct: m.resultPct,
  }));
  const cur = c.resultByMonth.at(-1)!;
  return (
    <ChartCard
      id="result"
      title="¿Estamos ganando?"
      reading={resultReading({
        month: cur.month,
        result: cur.result,
        resultPct: cur.resultPct,
        withdrawals: c.withdrawals,
        hasData: cur.hasData,
      })}
      legend={
        <>
          <LegendItem color="var(--viz-brand)" label="Resultado del mes" />
          <LegendItem
            color="var(--viz-ink)"
            label={`Retiros de los socios (${compactMoney(c.withdrawals)})`}
            kind="line"
          />
        </>
      }
      note="Los meses sin ventas, producciones ni gastos cargados no se dibujan."
      table={{
        caption: "Resultado mensual",
        head: ["Mes", "Resultado", "% de ventas", "Retiros"],
        rows: c.resultByMonth.map((m) => [
          capitalize(monthName(m.month)),
          m.hasData ? ars0(m.result) : "Sin datos",
          m.resultPct != null ? `${formatNumber(m.resultPct, 1)} %` : "—",
          ars0(c.withdrawals),
        ]),
      }}
    >
      <ResultPlot data={data} withdrawals={c.withdrawals} />
    </ChartCard>
  );
}

function MarginCard({ fin }: { fin: FinancialDashboard }) {
  const lists = fin.marginByChannel;
  const max = Math.max(10, ...lists.map((l) => Math.max(l.avgMarginPct ?? 0, l.targetMarginPct))) * 1.15;
  const rows: BarRow[] = lists.map((l) => {
    const under = l.avgMarginPct != null && l.avgMarginPct < l.targetMarginPct;
    return {
      key: l.listId,
      label: l.listName,
      sub: CHANNEL[l.channel] ?? l.channel,
      value: l.avgMarginPct,
      valueLabel: l.avgMarginPct != null ? `${formatNumber(l.avgMarginPct, 1)} %` : "Sin costo",
      color: CHANNEL_COLOR[l.channel] ?? "var(--viz-muted)",
      marker: l.targetMarginPct,
      flag: under ? "bajo el objetivo" : undefined,
      title: `Objetivo ${formatNumber(l.targetMarginPct, 0)} %${l.belowCost > 0 ? ` · ${l.belowCost} precio(s) bajo costo` : ""}`,
    };
  });
  return (
    <ChartCard
      id="margin"
      title="¿Qué canal deja más margen?"
      reading={marginReading(lists)}
      legend={<LegendItem color="var(--viz-ink)" label="Margen objetivo del canal" kind="tick" />}
      note="Margen promedio de los productos de cada lista de precios: (precio − costo directo) ÷ precio."
      table={{
        caption: "Margen por canal",
        head: ["Lista", "Margen promedio", "Objetivo", "Bajo objetivo"],
        rows: lists.map((l) => [
          l.listName,
          l.avgMarginPct != null ? `${formatNumber(l.avgMarginPct, 1)} %` : "Sin costo",
          `${formatNumber(l.targetMarginPct, 0)} %`,
          l.belowCost > 0 ? `${l.belowCost} bajo costo` : String(l.belowTarget),
        ]),
      }}
    >
      <BarList rows={rows} max={max} markerLabel="Margen objetivo" />
    </ChartCard>
  );
}

function TopCustomersCard({ fin }: { fin: FinancialDashboard }) {
  const top = fin.topCustomers;
  const rows: BarRow[] = top.map((c, i) => ({
    key: c.customerId,
    label: (
      <>
        <span className="text-muted-foreground mr-1.5 tabular-nums">{i + 1}.</span>
        <Link href={`/cobranzas/clientes/${c.customerId}` as Route} className="hover:underline">
          {c.name}
        </Link>
      </>
    ),
    value: c.net,
    valueLabel: compactMoney(c.net),
    color: "var(--viz-brand)",
    title: `${c.name}: ${formatARS(c.net)}`,
  }));
  return (
    <ChartCard
      id="top-customers"
      title="¿Quiénes compran más?"
      reading={topCustomersReading(fin.month, top, fin.salesNet)}
      note="Ventas netas facturadas en el mes elegido, las 10 mayores."
      table={{
        caption: "Mejores clientes del mes",
        head: ["Cliente", "Ventas netas"],
        rows: top.map((c) => [c.name, formatARS(c.net)]),
      }}
    >
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Todavía no hay facturas en el mes.</p>
      ) : (
        <BarList rows={rows} max={top[0]!.net} />
      )}
    </ChartCard>
  );
}

function CostPerBagCard({ fin }: { fin: FinancialDashboard }) {
  const series = fin.charts.costPerBagByMonth;
  const data = series.map((s) => ({
    key: s.month,
    label: monthShort(s.month),
    title: capitalize(monthName(s.month)),
    value: s.costPerBag,
    extra: s.costPerKg != null ? [{ label: "Costo por kg", value: ars0(s.costPerKg) }] : [],
  }));
  return (
    <ChartCard
      id="cost-bag"
      title="¿Cómo evoluciona el costo por bolsa?"
      reading={monthlyValueReading(
        series.map((s) => ({ month: s.month, value: s.costPerBag })),
        ars0,
        "costo por bolsa",
      )}
      note="Costo directo de la bolsa de 0,5 kg con el precio de compra vigente a fin de cada mes y el rendimiento real de los 60 días previos. Receta y mano de obra: las de hoy. Sin dato = faltaba el precio de algún insumo."
      table={{
        caption: "Costo por bolsa y por kg, por mes",
        head: ["Mes", "Costo por bolsa", "Costo por kg"],
        rows: series.map((s) => [
          capitalize(monthName(s.month)),
          s.costPerBag != null ? ars0(s.costPerBag) : "Sin dato",
          s.costPerKg != null ? ars0(s.costPerKg) : "Sin dato",
        ]),
      }}
    >
      <TrendPlot data={data} seriesLabel="Costo por bolsa" format={ars0} tick={ars0} step={100} />
    </ChartCard>
  );
}

function DeliveryCostCard({ fin }: { fin: FinancialDashboard }) {
  const series = fin.charts.deliveryByMonth;
  const data = series.map((s) => ({
    key: s.month,
    label: monthShort(s.month),
    title: capitalize(monthName(s.month)),
    value: s.costPerKg,
    extra: [
      { label: "Kg entregados", value: formatKg(s.kg) },
      { label: "Costo de las rutas", value: ars0(s.cost) },
    ],
  }));
  return (
    <ChartCard
      id="delivery-cost"
      title="¿Cuánto cuesta repartir?"
      reading={monthlyValueReading(
        series.map((s) => ({ month: s.month, value: s.costPerKg })),
        (n) => `${ars0(n)} por kg entregado`,
        "reparto",
      )}
      note="Costo de las rutas cerradas (vehículo y chofer) ÷ kg entregados."
      table={{
        caption: "Costo de reparto por mes",
        head: ["Mes", "Rutas", "Kg entregados", "Costo", "Costo por kg"],
        rows: series.map((s) => [
          capitalize(monthName(s.month)),
          String(s.routes),
          formatKg(s.kg),
          ars0(s.cost),
          s.costPerKg != null ? ars0(s.costPerKg) : "Sin rutas",
        ]),
      }}
    >
      <TrendPlot data={data} seriesLabel="Costo por kg entregado" format={ars0} tick={ars0} step={10} />
    </ChartCard>
  );
}

function DeliveryZoneCard({ fin }: { fin: FinancialDashboard }) {
  const zones = fin.charts.deliveryByZone;
  const max = Math.max(1, ...zones.map((z) => z.costPerKg ?? 0));
  const rows: BarRow[] = zones.map((z) => ({
    key: z.zoneId ?? "none",
    label: z.zone,
    sub: `${z.deliveries} entrega(s)`,
    value: z.costPerKg,
    valueLabel: z.costPerKg != null ? `${ars0(z.costPerKg)}/kg` : "—",
    color: "var(--viz-brand)",
    title: `${z.zone}: ${formatKg(z.kg)} entregados, ${ars0(z.cost)} de costo${z.partial ? " (costo parcial)" : ""}`,
  }));
  return (
    <ChartCard
      id="delivery-zone"
      title="¿Qué zona sale más cara de repartir?"
      reading={zoneReading(
        fin.month,
        zones.map((z) => ({ zone: z.zone, costPerKg: z.costPerKg })),
        ars0,
      )}
      note="El costo de cada ruta se reparte entre las zonas de sus entregas según los kg entregados."
      table={{
        caption: "Costo de reparto por zona",
        head: ["Zona", "Kg entregados", "Costo", "Costo por kg"],
        rows: zones.map((z) => [
          z.zone,
          formatKg(z.kg),
          ars0(z.cost),
          z.costPerKg != null ? ars0(z.costPerKg) : "—",
        ]),
      }}
    >
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Sin entregas con costo de reparto en el mes.</p>
      ) : (
        <BarList rows={rows} max={max * 1.15} />
      )}
    </ChartCard>
  );
}

const AGING: {
  key: "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";
  label: string;
  opacity: number;
}[] = [
  { key: "current", label: "Todavía no vence", opacity: 1 },
  { key: "d1_30", label: "Vencida 1–30 días", opacity: 0.5 },
  { key: "d31_60", label: "Vencida 31–60 días", opacity: 0.68 },
  { key: "d61_90", label: "Vencida 61–90 días", opacity: 0.84 },
  { key: "d90_plus", label: "Vencida más de 90 días", opacity: 1 },
];

function AgingCard({ fin }: { fin: FinancialDashboard }) {
  const a = fin.charts.receivablesAging;
  const max = Math.max(1, ...AGING.map((b) => a[b.key]));
  const rows: BarRow[] = AGING.map((b) => ({
    key: b.key,
    label: b.label,
    value: a[b.key],
    valueLabel: compactMoney(a[b.key]),
    color: b.key === "current" ? "var(--viz-1)" : "var(--viz-brand)",
    opacity: b.opacity,
    title: `${b.label}: ${formatARS(a[b.key])}`,
  }));
  return (
    <ChartCard
      id="aging"
      title="¿Cuánto nos deben y hace cuánto?"
      reading={agingReading(a)}
      note="Deuda de clientes de hoy, por días de mora (hoy − vencimiento de cada factura impaga)."
      table={{
        caption: "Deuda de clientes por antigüedad",
        head: ["Antigüedad", "Monto"],
        rows: [...AGING.map((b) => [b.label, formatARS(a[b.key])]), ["Total", formatARS(a.total)]],
      }}
    >
      {a.total <= 0 ? (
        <p className="text-muted-foreground text-sm">No hay deuda de clientes.</p>
      ) : (
        <BarList rows={rows} max={max} />
      )}
    </ChartCard>
  );
}

/** Gráficos con montos: sólo se llama con `fin` (quien tiene `finance:read`). */
export function FinancialChartSections({ fin }: { fin: FinancialDashboard }) {
  return (
    <>
      <ChartGroup id="g-sales" title="Ventas y resultado">
        <SalesCard fin={fin} />
        <ResultCard fin={fin} />
        <MarginCard fin={fin} />
        <TopCustomersCard fin={fin} />
      </ChartGroup>
      <ChartGroup id="g-costs" title="Costos y reparto">
        <CostPerBagCard fin={fin} />
        <DeliveryCostCard fin={fin} />
        <DeliveryZoneCard fin={fin} />
      </ChartGroup>
      <ChartGroup id="g-receivables" title="Cobranzas">
        <AgingCard fin={fin} />
      </ChartGroup>
    </>
  );
}

// ------------------------------------------------------------------------------------------------
// Operativo (sin montos)
// ------------------------------------------------------------------------------------------------

function ProductionCard({ op }: { op: OperationalDashboard }) {
  const data = op.dailyProduction.map((p) => ({ ...p, label: dayLabel(p.date) }));
  return (
    <ChartCard
      id="production"
      title="¿Cuánto producimos contra la capacidad?"
      reading={productionReading({
        producedKg: op.capacity.producedKg,
        workdays: op.capacity.workdays,
        usagePct: op.capacity.usagePct,
        capacityKg: op.capacity.capacityKg,
        daily: op.dailyProduction,
      })}
      legend={
        <>
          <LegendItem color="var(--viz-brand)" label="Kg producidos" />
          <LegendItem
            color="var(--viz-muted)"
            label={`Capacidad ${op.capacity.capacityKg} kg/día`}
            kind="line"
          />
        </>
      }
      table={{
        caption: "Producción diaria",
        head: ["Día", "Kg", "Uso de capacidad"],
        rows: data.map((d) => [
          d.label,
          formatKg(d.kg),
          `${formatNumber((d.kg / op.capacity.capacityKg) * 100, 0)} %`,
        ]),
      }}
    >
      <ProductionPlot data={data} capacityKg={op.capacity.capacityKg} />
    </ChartCard>
  );
}

function YieldCard({ op }: { op: OperationalDashboard }) {
  const runs = op.charts.yieldByRun;
  const avg = runs.length
    ? (runs.reduce((a, r) => a + r.weighedKg, 0) / runs.reduce((a, r) => a + r.ingredientsKg, 0)) * 100
    : null;
  const pct = (n: number) => `${formatNumber(n, 1)} %`;
  const data = runs.map((r) => ({
    key: r.runId,
    label: shortDate(r.date),
    title: `Producción del ${shortDate(r.date)}${r.runNumber > 1 ? ` (n.º ${r.runNumber})` : ""}`,
    value: r.yieldPct,
    extra: [
      { label: "Kg pesados", value: formatKg(r.weighedKg) },
      { label: "Kg de ingredientes", value: formatKg(r.ingredientsKg) },
    ],
  }));
  return (
    <ChartCard
      id="yield"
      title="¿Cuánto rinde cada producción?"
      reading={yieldReading(runs)}
      note="Rendimiento = kg pesados ÷ kg de ingredientes reales (Regla 3). Producciones de los últimos 45 días."
      table={{
        caption: "Rendimiento por producción",
        head: ["Producción", "Kg pesados", "Kg de ingredientes", "Rendimiento"],
        rows: runs.map((r) => [
          shortDate(r.date),
          formatKg(r.weighedKg),
          formatKg(r.ingredientsKg),
          pct(r.yieldPct),
        ]),
      }}
    >
      {runs.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Sin producciones con pesadas y consumos en los últimos 45 días.
        </p>
      ) : (
        <TrendPlot
          data={data}
          seriesLabel="Rendimiento"
          format={pct}
          tick={(n) => `${n} %`}
          step={1}
          reference={avg != null ? { value: avg, label: `Promedio ${pct(avg)}` } : undefined}
        />
      )}
    </ChartCard>
  );
}

function CoverageCard({ op }: { op: OperationalDashboard }) {
  const items = op.charts.coverage;
  const rows: BarRow[] = items.map((c) => {
    const reorder = c.status === "reorder" || c.status === "out_of_stock";
    return {
      key: c.ingredientId,
      label: c.name,
      value: c.coverageDays == null ? null : Math.min(c.coverageDays, COVERAGE_CAP_DAYS),
      valueLabel:
        c.status === "out_of_stock"
          ? "Sin stock"
          : c.coverageDays != null
            ? `${formatNumber(c.coverageDays, 0)} días`
            : "—",
      color: "var(--viz-1)",
      marker: c.reorderDays != null ? Math.min(c.reorderDays, COVERAGE_CAP_DAYS) : null,
      flag: reorder ? "Reponer" : undefined,
      title: `${c.name}: ${formatNumber(c.stock, 1)} ${c.unit} en stock${c.reorderDays != null ? ` · punto de pedido a ${formatNumber(c.reorderDays, 0)} días` : ""}`,
    };
  });
  return (
    <ChartCard
      id="coverage"
      title="¿Alcanza la materia prima?"
      reading={coverageReading(items)}
      legend={
        <>
          <LegendItem color="var(--viz-1)" label="Días que rinde el stock" />
          <LegendItem color="var(--viz-ink)" label="Punto de pedido" kind="tick" />
        </>
      }
      note={`Cobertura = stock ÷ consumo diario de los últimos 30 días. Los insumos sin consumo no se muestran; la barra llega hasta ${COVERAGE_CAP_DAYS} días.`}
      table={{
        caption: "Cobertura de materia prima",
        head: ["Insumo", "Stock", "Cobertura (días)", "Punto de pedido (días)"],
        rows: items.map((c) => [
          c.name,
          `${formatNumber(c.stock, 1)} ${c.unit}`,
          c.status === "out_of_stock"
            ? "Sin stock"
            : c.coverageDays != null
              ? formatNumber(c.coverageDays, 1)
              : "—",
          c.reorderDays != null ? formatNumber(c.reorderDays, 1) : "—",
        ]),
      }}
    >
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Todavía no hay consumos para calcular la cobertura.</p>
      ) : (
        <BarList rows={rows} max={COVERAGE_CAP_DAYS} markerLabel="Punto de pedido" />
      )}
    </ChartCard>
  );
}

function OtifCard({ op }: { op: OperationalDashboard }) {
  const weeks = op.charts.otifByWeek;
  const data = weeks.map((w) => ({ ...w, label: shortDate(w.weekFrom) }));
  return (
    <ChartCard
      id="otif"
      title="¿Entregamos a tiempo y completo?"
      reading={otifReading(weeks)}
      note="Pedidos entregados cada semana (lunes a domingo) en la fecha comprometida o antes y con todo lo pedido. Las semanas sin entregas no tienen barra."
      table={{
        caption: "Entregas a tiempo y completas por semana",
        head: ["Semana del", "A tiempo y completas", "Pedidos"],
        rows: weeks.map((w) => [
          shortDate(w.weekFrom),
          w.pct != null ? `${formatNumber(w.pct, 1)} %` : "Sin entregas",
          w.delivered > 0 ? `${w.ok} de ${w.delivered}` : "—",
        ]),
      }}
    >
      <OtifPlot data={data} target={OTIF_TARGET} />
    </ChartCard>
  );
}

function StoreCard({ op }: { op: OperationalDashboard }) {
  const days = op.charts.storeDaily;
  const data = days.map((d) => ({ date: d.date, label: dayLabel(d.date), value: d.units }));
  return (
    <ChartCard
      id="store"
      title="¿Cuánto vende el local por día?"
      reading={storeReading(days, op.today)}
      note="Unidades vendidas por día en el local (sin las ventas anuladas)."
      table={{
        caption: "Unidades vendidas por día en el local",
        head: ["Día", "Unidades"],
        rows: data.map((d) => [d.label, String(d.value)]),
      }}
    >
      <DailyUnitsPlot data={data} unitLabel="Unidades vendidas" />
    </ChartCard>
  );
}

function TemperatureCard({ op }: { op: OperationalDashboard }) {
  const days = op.charts.temperaturesDaily;
  const data = days.map((d) => ({
    date: d.date,
    label: dayLabel(d.date),
    ok: d.readings - d.outOfRange,
    out: d.outOfRange,
  }));
  return (
    <ChartCard
      id="temperatures"
      title="¿Se registraron las temperaturas y estuvieron en rango?"
      reading={temperatureReading(days, op.today)}
      legend={
        <>
          <LegendItem color="var(--viz-1)" label="Dentro de rango" />
          <LegendItem color="var(--viz-bad)" label="▲ Fuera de rango" />
        </>
      }
      note="Registros de temperatura de freezers, heladera y vehículo por día. Un día sin barra es un día sin registros."
      table={{
        caption: "Registros de temperatura por día",
        head: ["Día", "Registros", "Fuera de rango"],
        rows: days.map((d) => [dayLabel(d.date), String(d.readings), String(d.outOfRange)]),
      }}
    >
      <TemperaturePlot data={data} />
    </ChartCard>
  );
}

/** Gráficos operativos: producción, entregas, local y calidad. Sin ningún monto. */
export function OperationalChartSections({ op }: { op: OperationalDashboard }) {
  return (
    <>
      <ChartGroup id="g-production" title="Producción">
        <ProductionCard op={op} />
        <YieldCard op={op} />
        <CoverageCard op={op} />
      </ChartGroup>
      <ChartGroup id="g-delivery" title="Entregas y local">
        <OtifCard op={op} />
        <StoreCard op={op} />
      </ChartGroup>
      <ChartGroup id="g-quality" title="Calidad">
        <TemperatureCard op={op} />
      </ChartGroup>
    </>
  );
}
