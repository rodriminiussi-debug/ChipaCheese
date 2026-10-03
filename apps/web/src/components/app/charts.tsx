"use client";

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatARS, formatKg } from "@chipa/domain";
import { compactMoney } from "@/features/finance/format";

/**
 * Gráficos del tablero y del resultado mensual. Siguen la guía dataviz: paleta categórica en orden fijo
 * (azul, naranja, aqua, amarillo) validada en claro y oscuro, barras finas con extremo redondeado de 4 px,
 * grilla de 1 px, tooltip al pasar, leyenda cuando hay 2 o más series y vista de tabla (los tonos claros
 * del modo claro quedan bajo 3:1, por eso cada gráfico ofrece su tabla).
 */
const THEME = `
.viz-root{--viz-text:#52514e;--viz-muted:#767571;--viz-grid:#e6e5e1;--viz-surface:#fcfcfb;--viz-1:#2a78d6;--viz-2:#eb6834;--viz-3:#1baf7a;--viz-4:#eda100}
.dark .viz-root{--viz-text:#c3c2b7;--viz-muted:#9a9990;--viz-grid:#383835;--viz-surface:#1a1a19;--viz-1:#3987e5;--viz-2:#d95926;--viz-3:#199e70;--viz-4:#c98500}
.viz-root .recharts-text{fill:var(--viz-text)}
`;

/** Color por canal: la identidad manda (no el ranking), así un filtro no repinta a los demás. */
export const CHANNEL_COLOR: Record<string, string> = {
  supermarket: "var(--viz-1)",
  reseller: "var(--viz-2)",
  store: "var(--viz-3)",
  distributor: "var(--viz-4)",
  other: "var(--viz-4)",
};

function Frame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="viz-root" role="img" aria-label={label}>
      <style>{THEME}</style>
      {children}
    </div>
  );
}

function LegendItem({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
      <span
        aria-hidden
        className={
          line ? "inline-block h-0.5 w-4 shrink-0 rounded" : "inline-block size-2.5 shrink-0 rounded-sm"
        }
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

function TooltipBox({
  active,
  title,
  rows,
}: {
  active?: boolean;
  title: string;
  rows: { label: string; value: string; color?: string }[];
}) {
  if (!active) return null;
  return (
    <div className="bg-popover text-popover-foreground rounded-md border px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          {r.color ? (
            <span aria-hidden className="size-2 rounded-sm" style={{ background: r.color }} />
          ) : null}
          <span className="text-muted-foreground">{r.label}</span>
          <span className="ml-auto pl-3 tabular-nums">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------

export interface ProductionPoint {
  date: string;
  /** "lun 28" */
  label: string;
  kg: number;
  workday: boolean;
}

/** Producción diaria de las últimas 2 semanas contra la capacidad del abatidor (150 kg/día). */
export function ProductionChart({ data, capacityKg }: { data: ProductionPoint[]; capacityKg: number }) {
  const max = Math.max(capacityKg, ...data.map((d) => d.kg));
  return (
    <figure className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <div className="flex flex-wrap gap-4">
        <LegendItem color="var(--viz-1)" label="Kg producidos" />
        <LegendItem color="var(--viz-muted)" label={`Capacidad ${capacityKg} kg/día`} line />
      </div>
      <Frame label="Producción diaria de las últimas dos semanas contra la capacidad">
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeWidth={1} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: "var(--viz-grid)" }}
                fontSize={11}
                interval={0}
                angle={-45}
                textAnchor="end"
                height={42}
              />
              <YAxis
                domain={[0, Math.ceil((max * 1.1) / 50) * 50]}
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={36}
              />
              <Tooltip
                cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as ProductionPoint | undefined;
                  return p ? (
                    <TooltipBox
                      active={active}
                      title={p.label}
                      rows={[
                        { label: "Producido", value: formatKg(p.kg), color: "var(--viz-1)" },
                        { label: "Uso de capacidad", value: `${Math.round((p.kg / capacityKg) * 100)} %` },
                      ]}
                    />
                  ) : null;
                }}
              />
              <ReferenceLine y={capacityKg} stroke="var(--viz-muted)" strokeWidth={2} />
              <Bar
                dataKey="kg"
                fill="var(--viz-1)"
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
                isAnimationActive={false}
              >
                {data.map((d) => (
                  <Cell key={d.date} fill="var(--viz-1)" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Frame>
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

export interface ChannelPoint {
  channel: string;
  label: string;
  net: number;
}

/** Ventas netas del mes por canal: barras horizontales con el valor en la punta. */
export function ChannelSalesChart({ data }: { data: ChannelPoint[] }) {
  return (
    <figure className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <Frame label="Ventas netas del mes por canal">
        <div style={{ height: Math.max(120, data.length * 48 + 16) }} className="w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 84, bottom: 4, left: 0 }}>
              <CartesianGrid horizontal={false} stroke="var(--viz-grid)" strokeWidth={1} />
              <XAxis type="number" hide domain={[0, "dataMax"]} />
              <YAxis
                type="category"
                dataKey="label"
                tickLine={false}
                axisLine={false}
                fontSize={12}
                width={104}
              />
              <Tooltip
                cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as ChannelPoint | undefined;
                  return p ? (
                    <TooltipBox
                      active={active}
                      title={p.label}
                      rows={[
                        { label: "Ventas netas", value: formatARS(p.net), color: CHANNEL_COLOR[p.channel] },
                      ]}
                    />
                  ) : null;
                }}
              />
              <Bar dataKey="net" radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.channel} fill={CHANNEL_COLOR[d.channel] ?? "var(--viz-4)"} />
                ))}
                <LabelList
                  dataKey="net"
                  position="right"
                  fontSize={11}
                  formatter={(v: unknown) => compactMoney(Number(v))}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Frame>
      <details className="text-xs">
        <summary className="text-muted-foreground cursor-pointer">Ver como tabla</summary>
        <table className="mt-2 w-full max-w-sm">
          <caption className="sr-only">Ventas netas por canal</caption>
          <tbody>
            {data.map((d) => (
              <tr key={d.channel}>
                <td className="py-0.5">{d.label}</td>
                <td className="py-0.5 text-right tabular-nums">{formatARS(d.net)}</td>
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
}

/** Resultado de los últimos meses contra lo que retiran los socios. */
export function ResultChart({ data, withdrawals }: { data: ResultPoint[]; withdrawals: number }) {
  const values = data.map((d) => d.result ?? 0);
  // Eje con topes redondos (múltiplos de $1 M, o de $100 mil si todo es chico).
  const unit = Math.max(withdrawals, ...values.map(Math.abs)) >= 2_000_000 ? 1_000_000 : 100_000;
  const top = Math.ceil(Math.max(withdrawals, ...values) / unit) * unit;
  const bottom = Math.floor(Math.min(0, ...values) / unit) * unit;
  return (
    <figure className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <div className="flex flex-wrap gap-4">
        <LegendItem color="var(--viz-1)" label="Resultado del mes" />
        <LegendItem
          color="var(--viz-2)"
          label={`Retiros de los socios (${compactMoney(withdrawals)})`}
          line
        />
      </div>
      <Frame label="Resultado de los últimos seis meses contra los retiros de los socios">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap="35%">
              <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeWidth={1} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: "var(--viz-grid)" }}
                fontSize={11}
              />
              <YAxis
                domain={[bottom, top]}
                tickFormatter={(v: number) => compactMoney(v)}
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={64}
              />
              <Tooltip
                cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }}
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
                          color: "var(--viz-1)",
                        },
                        { label: "Retiros", value: formatARS(withdrawals), color: "var(--viz-2)" },
                      ]}
                    />
                  ) : null;
                }}
              />
              <ReferenceLine y={0} stroke="var(--viz-muted)" strokeWidth={1} />
              <ReferenceLine y={withdrawals} stroke="var(--viz-2)" strokeWidth={2} />
              <Bar
                dataKey="result"
                fill="var(--viz-1)"
                radius={[4, 4, 4, 4]}
                maxBarSize={24}
                isAnimationActive={false}
              ></Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Frame>
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
