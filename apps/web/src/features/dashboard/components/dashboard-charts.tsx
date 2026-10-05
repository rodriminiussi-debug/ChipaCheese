"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatARS, formatNumber } from "@chipa/domain";
import {
  AXIS,
  AXIS_NO_LINE,
  CHANNEL_COLOR,
  CHANNEL_ORDER,
  CURSOR,
  GAP,
  GRID,
  TooltipBox,
} from "@/components/app/viz";
import { compactMoney } from "@/features/finance/format";
import { CHANNEL } from "@/lib/labels";

/**
 * Gráficos de series del tablero (recharts). Reciben datos ya armados por el servidor, con las etiquetas de los
 * ejes en español argentino. Colores: tokens `--viz-*`; barras finas (≤ 24 px) con extremo de 4 px; líneas de 2 px
 * con puntos de 8 px y anillo del color de la tarjeta; grilla de 1 px.
 */

/** Primer y último valor no nulo (para etiquetar el extremo de una línea). */
function lastIndex(values: (number | null)[]) {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return i;
  return -1;
}

/** Eje con topes redondos que no empieza en 0: para series de valores que se mueven poco (costos, rendimiento). */
function paddedDomain(values: number[], step: number): [number, number] {
  if (values.length === 0) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.25, step);
  return [Math.floor((min - pad) / step) * step, Math.ceil((max + pad) / step) * step];
}

// ------------------------------------------------------------------------------------------------
// Ventas por canal, mes a mes (columnas apiladas)
// ------------------------------------------------------------------------------------------------

export interface SalesStackPoint {
  month: string;
  label: string;
  total: number;
  /** Ventas netas por canal. */
  byChannel: Record<string, number>;
}

export function SalesStackPlot({ data }: { data: SalesStackPoint[] }) {
  const channels = CHANNEL_ORDER.filter((c) => data.some((d) => (d.byChannel[c] ?? 0) !== 0));
  const rows = data.map((d) => ({ ...d, ...d.byChannel }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap="35%">
          <CartesianGrid vertical={false} {...GRID} />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis tickFormatter={(v: number) => compactMoney(v)} {...AXIS_NO_LINE} width={64} tickCount={5} />
          <Tooltip
            cursor={CURSOR}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (SalesStackPoint & Record<string, number>) | undefined;
              return p ? (
                <TooltipBox
                  active={active}
                  title={p.label}
                  rows={[
                    ...[...channels].reverse().map((c) => ({
                      label: CHANNEL[c] ?? c,
                      value: formatARS(p.byChannel[c] ?? 0, { decimals: 0 }),
                      color: CHANNEL_COLOR[c],
                    })),
                    { label: "Total", value: formatARS(p.total, { decimals: 0 }) },
                  ]}
                />
              ) : null;
            }}
          />
          {channels.map((c) => (
            <Bar
              key={c}
              dataKey={c}
              stackId="ventas"
              fill={CHANNEL_COLOR[c]}
              {...GAP}
              maxBarSize={24}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Línea mensual / por producción (costo por bolsa, costo de reparto, rendimiento)
// ------------------------------------------------------------------------------------------------

export interface TrendPoint {
  key: string;
  /** Etiqueta del eje ("sep 26", "19/08"). */
  label: string;
  /** Título del tooltip. */
  title: string;
  value: number | null;
  /** Filas extra del tooltip. */
  extra?: { label: string; value: string }[];
}

/**
 * Línea de una sola serie con puntos de 8 px, el valor del último punto escrito al final y, opcionalmente, una
 * línea de referencia (promedio). Los meses sin dato quedan como hueco (no se dibuja un 0).
 */
export function TrendPlot({
  data,
  seriesLabel,
  format,
  tick,
  step,
  reference,
  height = 224,
}: {
  data: TrendPoint[];
  seriesLabel: string;
  /** Valor completo para el tooltip y la etiqueta final. */
  format: (n: number) => string;
  tick: (n: number) => string;
  /** Paso del eje (para redondear los topes). */
  step: number;
  reference?: { value: number; label: string };
  height?: number;
}) {
  const values = data.map((d) => d.value);
  const last = lastIndex(values);
  const nums = values.filter((v): v is number => v != null);
  const domain = paddedDomain(reference ? [...nums, reference.value] : nums, step);
  const dense = data.length > 14;
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 56, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} {...GRID} />
          <XAxis
            dataKey="label"
            {...AXIS}
            interval={dense ? "preserveStartEnd" : 0}
            minTickGap={dense ? 24 : 0}
          />
          <YAxis
            domain={domain}
            tickFormatter={tick}
            {...AXIS_NO_LINE}
            width={60}
            tickCount={5}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as TrendPoint | undefined;
              return p ? (
                <TooltipBox
                  active={active}
                  title={p.title}
                  rows={[
                    {
                      label: seriesLabel,
                      value: p.value == null ? "Sin dato" : format(p.value),
                      color: "var(--viz-brand)",
                    },
                    ...(p.extra ?? []),
                  ]}
                />
              ) : null;
            }}
          />
          {reference ? (
            <ReferenceLine
              y={reference.value}
              stroke="var(--viz-muted)"
              strokeWidth={1}
              label={{
                value: reference.label,
                position: "insideTopLeft",
                fill: "var(--viz-text)",
                fontSize: 11,
              }}
            />
          ) : null}
          <Line
            dataKey="value"
            stroke="var(--viz-brand)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            connectNulls={false}
            isAnimationActive={false}
            dot={{ r: 4, fill: "var(--viz-brand)", stroke: "var(--viz-surface)", strokeWidth: 2 }}
            activeDot={{ r: 5, fill: "var(--viz-brand)", stroke: "var(--viz-surface)", strokeWidth: 2 }}
          >
            <LabelList
              dataKey="value"
              content={(props) => {
                const { x, y, index, value } = props as {
                  x?: number;
                  y?: number;
                  index?: number;
                  value?: number;
                };
                if (index !== last || x == null || y == null || value == null) return null;
                return (
                  <text x={x + 8} y={y + 4} fontSize={11} fontWeight={600} fill="var(--viz-ink)">
                    {format(value)}
                  </text>
                );
              }}
            />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Entregas a tiempo y completas por semana (columnas con meta)
// ------------------------------------------------------------------------------------------------

export interface OtifPoint {
  weekFrom: string;
  label: string;
  pct: number | null;
  delivered: number;
  ok: number;
}

export function OtifPlot({ data, target }: { data: OtifPoint[]; target: number }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} {...GRID} />
          <XAxis dataKey="label" {...AXIS} interval={0} />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v: number) => `${v} %`}
            {...AXIS_NO_LINE}
            width={44}
          />
          <Tooltip
            cursor={CURSOR}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as OtifPoint | undefined;
              return p ? (
                <TooltipBox
                  active={active}
                  title={`Semana del ${p.label}`}
                  rows={
                    p.delivered === 0
                      ? [{ label: "Pedidos entregados", value: "ninguno" }]
                      : [
                          {
                            label: "A tiempo y completos",
                            value: `${formatNumber(p.pct ?? 0, 1)} %`,
                            color: "var(--viz-brand)",
                          },
                          { label: "Pedidos", value: `${p.ok} de ${p.delivered}` },
                        ]
                  }
                />
              ) : null;
            }}
          />
          <ReferenceLine
            y={target}
            stroke="var(--viz-ink)"
            strokeWidth={2}
            label={{
              value: `Meta ${target} %`,
              position: "insideBottomRight",
              fill: "var(--viz-text)",
              fontSize: 11,
            }}
          />
          <Bar
            dataKey="pct"
            fill="var(--viz-brand)"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="pct"
              position="top"
              fontSize={11}
              fill="var(--viz-text)"
              formatter={(v: unknown) => (v == null ? "" : `${formatNumber(Number(v), 0)}`)}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Unidades por día (local)
// ------------------------------------------------------------------------------------------------

export interface DayPoint {
  date: string;
  label: string;
  value: number;
}

export function DailyUnitsPlot({ data, unitLabel }: { data: DayPoint[]; unitLabel: string }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} {...GRID} />
          <XAxis dataKey="label" {...AXIS} interval={0} angle={-45} textAnchor="end" height={42} />
          <YAxis {...AXIS_NO_LINE} width={36} tickCount={4} allowDecimals={false} />
          <Tooltip
            cursor={CURSOR}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as DayPoint | undefined;
              return p ? (
                <TooltipBox
                  active={active}
                  title={p.label}
                  rows={[{ label: unitLabel, value: formatNumber(p.value, 0), color: "var(--viz-brand)" }]}
                />
              ) : null;
            }}
          />
          <Bar
            dataKey="value"
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

// ------------------------------------------------------------------------------------------------
// Registros de temperatura por día (dentro / fuera de rango)
// ------------------------------------------------------------------------------------------------

export interface TemperaturePoint {
  date: string;
  label: string;
  ok: number;
  out: number;
}

export function TemperaturePlot({ data }: { data: TemperaturePoint[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} {...GRID} />
          <XAxis dataKey="label" {...AXIS} interval={0} angle={-45} textAnchor="end" height={42} />
          <YAxis {...AXIS_NO_LINE} width={36} tickCount={4} allowDecimals={false} />
          <Tooltip
            cursor={CURSOR}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as TemperaturePoint | undefined;
              return p ? (
                <TooltipBox
                  active={active}
                  title={p.label}
                  rows={[
                    { label: "Dentro de rango", value: String(p.ok), color: "var(--viz-1)" },
                    { label: "Fuera de rango", value: String(p.out), color: "var(--viz-bad)" },
                  ]}
                />
              ) : null;
            }}
          />
          <Bar
            dataKey="ok"
            stackId="t"
            fill="var(--viz-1)"
            {...GAP}
            maxBarSize={24}
            isAnimationActive={false}
          />
          <Bar
            dataKey="out"
            stackId="t"
            fill="var(--viz-bad)"
            {...GAP}
            maxBarSize={24}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
