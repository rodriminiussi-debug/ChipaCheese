"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatARS, formatDateAR } from "@chipa/domain";

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];

export interface PriceSeries {
  key: string;
  name: string;
  points: { date: string; price: number }[];
}

/** Precio neto en el tiempo, una línea por proveedor (RF-09). */
export function PriceChart({ series }: { series: PriceSeries[] }) {
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  const data = dates.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const s of series) {
      const p = s.points.find((x) => x.date === date);
      if (p) row[s.key] = p.price;
    }
    return row;
  });
  return (
    <div className="h-72 w-full" role="img" aria-label="Gráfico del precio neto en el tiempo">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d: string) => formatDateAR(d).slice(0, 5)} fontSize={12} />
          <YAxis
            tickFormatter={(v: number) => formatARS(v)}
            width={80}
            fontSize={12}
            domain={["auto", "auto"]}
          />
          <Tooltip
            labelFormatter={(d) => formatDateAR(String(d))}
            formatter={(v) => formatARS(Number(v), { decimals: 2 })}
          />
          <Legend />
          {series.map((s, i) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
