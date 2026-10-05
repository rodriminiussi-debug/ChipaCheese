"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatARS, formatKg, formatNumber } from "@chipa/domain";
import { compactMoney } from "@/features/finance/format";
import { AXIS, AXIS_NO_LINE, CURSOR, GRID, Legend, LegendItem, TooltipBox } from "./viz";

/**
 * Gráficos de producción y de resultado mensual (tablero y /costos/resultado). Siguen la guía dataviz: color de
 * los tokens `--viz-*` (claro y noche), barras finas con extremo redondeado de 4 px, grilla de 1 px, tooltip al
 * pasar y vista de tabla. `*Plot` es sólo el dibujo (lo usa la tarjeta del tablero); `*Chart` suma leyenda y tabla.
 */

export interface ProductionPoint {
  date: string;
  /** "lun 28" */
  label: string;
  kg: number;
  workday: boolean;
}

/** Producción diaria contra la capacidad del abatidor (150 kg/día). */
export function ProductionPlot({ data, capacityKg }: { data: ProductionPoint[]; capacityKg: number }) {
  const max = Math.max(capacityKg, ...data.map((d) => d.kg));
  return (
    <div className="h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} {...GRID} />
          <XAxis dataKey="label" {...AXIS} interval={0} angle={-45} textAnchor="end" height={42} />
          <YAxis domain={[0, Math.ceil((max * 1.1) / 50) * 50]} {...AXIS_NO_LINE} width={36} tickCount={4} />
          <Tooltip
            cursor={CURSOR}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as ProductionPoint | undefined;
              return p ? (
                <TooltipBox
                  active={active}
                  title={p.label}
                  rows={[
                    { label: "Producido", value: formatKg(p.kg), color: "var(--viz-brand)" },
                    { label: "Uso de capacidad", value: `${Math.round((p.kg / capacityKg) * 100)} %` },
                  ]}
                />
              ) : null;
            }}
          />
          <ReferenceLine
            y={capacityKg}
            stroke="var(--viz-muted)"
            strokeWidth={2}
            label={{
              value: `Capacidad ${capacityKg} kg`,
              position: "insideTopLeft",
              fill: "var(--viz-text)",
              fontSize: 11,
            }}
          />
          <Bar
            dataKey="kg"
            fill="var(--viz-brand)"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ProductionChart({ data, capacityKg }: { data: ProductionPoint[]; capacityKg: number }) {
  return (
    <figure className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <Legend>
        <LegendItem color="var(--viz-brand)" label="Kg producidos" />
        <LegendItem color="var(--viz-muted)" label={`Capacidad ${capacityKg} kg/día`} kind="line" />
      </Legend>
      <div role="img" aria-label="Producción diaria de las últimas dos semanas contra la capacidad">
        <ProductionPlot data={data} capacityKg={capacityKg} />
      </div>
      <details className="text-xs">
        <summary className="text-muted-foreground cursor-pointer">Ver como tabla</summary>
        <table className="mt-2 w-full max-w-sm">
          <caption className="sr-only">Producción diaria</caption>
          <thead>
            <tr className="text-muted-foreground text-left">
              <th className="py-1 font-medium">Día</th>
              <th className="py-1 text-right font-medium">Kg</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.date}>
                <td className="py-0.5">{d.label}</td>
                <td className="py-0.5 text-right tabular-nums">{formatKg(d.kg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

// ------------------------------------------------------------------------------------------------

export interface ResultPoint {
  month: string;
  label: string;
  /** null = mes sin datos (no se dibuja). */
  result: number | null;
  /** Resultado ÷ ventas, en %. */
  resultPct?: number | null;
}

/** Resultado de cada mes contra lo que retiran los socios (línea de referencia con su etiqueta). */
export function ResultPlot({ data, withdrawals }: { data: ResultPoint[]; withdrawals: number }) {
  const values = data.map((d) => d.result ?? 0);
  // Eje con topes redondos (múltiplos de $1 M, o de $100 mil si todo es chico).
  const unit = Math.max(withdrawals, ...values.map(Math.abs)) >= 2_000_000 ? 1_000_000 : 100_000;
  const top = Math.ceil(Math.max(withdrawals, ...values) / unit) * unit;
  const bottom = Math.floor(Math.min(0, ...values) / unit) * unit;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap="35%">
          <CartesianGrid vertical={false} {...GRID} />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis
            domain={[bottom, top]}
            tickFormatter={(v: number) => compactMoney(v)}
            {...AXIS_NO_LINE}
            width={64}
            tickCount={5}
          />
          <Tooltip
            cursor={CURSOR}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as ResultPoint | undefined;
              return p ? (
                <TooltipBox
                  active={active}
                  title={p.label}
                  rows={[
                    {
                      label: "Resultado",
                      value: p.result == null ? "Sin datos" : formatARS(p.result),
                      color: "var(--viz-brand)",
                    },
                    ...(p.resultPct != null
                      ? [{ label: "De las ventas", value: `${formatNumber(p.resultPct, 1)} %` }]
                      : []),
                    { label: "Retiros", value: formatARS(withdrawals), color: "var(--viz-ink)" },
                  ]}
                />
              ) : null;
            }}
          />
          <ReferenceLine y={0} stroke="var(--viz-axis)" strokeWidth={1} />
          <ReferenceLine
            y={withdrawals}
            stroke="var(--viz-ink)"
            strokeWidth={2}
            label={{
              value: `Retiros ${compactMoney(withdrawals)}`,
              position: "insideTopLeft",
              fill: "var(--viz-text)",
              fontSize: 11,
            }}
          />
          <Bar
            dataKey="result"
            fill="var(--viz-brand)"
            radius={[4, 4, 4, 4]}
            maxBarSize={24}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ResultChart({ data, withdrawals }: { data: ResultPoint[]; withdrawals: number }) {
  return (
    <figure className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <Legend>
        <LegendItem color="var(--viz-brand)" label="Resultado del mes" />
        <LegendItem
          color="var(--viz-ink)"
          label={`Retiros de los socios (${compactMoney(withdrawals)})`}
          kind="line"
        />
      </Legend>
      <div role="img" aria-label="Resultado de los últimos seis meses contra los retiros de los socios">
        <ResultPlot data={data} withdrawals={withdrawals} />
      </div>
      <details className="text-xs">
        <summary className="text-muted-foreground cursor-pointer">Ver como tabla</summary>
        <table className="mt-2 w-full max-w-md">
          <caption className="sr-only">Resultado por mes</caption>
          <thead>
            <tr className="text-muted-foreground text-left">
              <th className="py-1 font-medium">Mes</th>
              <th className="py-1 text-right font-medium">Resultado</th>
              <th className="py-1 text-right font-medium">Retiros</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.month}>
                <td className="py-0.5">{d.label}</td>
                <td className="py-0.5 text-right tabular-nums">
                  {d.result == null ? "Sin datos" : formatARS(d.result)}
                </td>
                <td className="py-0.5 text-right tabular-nums">{formatARS(withdrawals)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
