import type { CSSProperties, ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Piezas compartidas de los gráficos (guía dataviz). Los colores salen de los tokens `--viz-*` de globals.css,
 * que cambian solos en modo noche. Nada de acá usa hooks: se puede renderizar desde el servidor o el cliente.
 */

/** Color por canal: la identidad manda (no el ranking), así un filtro no repinta a los demás. */
export const CHANNEL_COLOR: Record<string, string> = {
  supermarket: "var(--viz-1)",
  reseller: "var(--viz-2)",
  store: "var(--viz-3)",
  distributor: "var(--viz-4)",
  other: "var(--viz-muted)",
};
/** Orden fijo de los canales en pilas y leyendas. */
export const CHANNEL_ORDER = ["supermarket", "reseller", "store", "distributor", "other"] as const;

/** Props comunes de los ejes de recharts: sin rayitas, texto recesivo, línea de 1 px. */
export const AXIS = {
  tickLine: false,
  axisLine: { stroke: "var(--viz-axis)" },
  tick: { fontSize: 11, fill: "var(--viz-text)" },
} as const;
export const AXIS_NO_LINE = { ...AXIS, axisLine: false } as const;
export const GRID = { stroke: "var(--viz-grid)", strokeWidth: 1 } as const;
/** Hueco de 2 px del color de la tarjeta entre segmentos que se tocan (en vez de un borde). */
export const GAP = { stroke: "var(--viz-surface)", strokeWidth: 2 } as const;
export const CURSOR = { fill: "var(--viz-grid)", opacity: 0.5 } as const;

export function LegendItem({
  color,
  label,
  kind = "box",
  style,
}: {
  color: string;
  label: string;
  kind?: "box" | "line" | "tick";
  style?: CSSProperties;
}) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
      <span
        aria-hidden
        className={cn(
          "inline-block shrink-0",
          kind === "box" && "size-2.5 rounded-sm",
          kind === "line" && "h-0.5 w-4 rounded",
          kind === "tick" && "h-3 w-0.5",
        )}
        style={{ background: color, ...style }}
      />
      {label}
    </span>
  );
}

export function Legend({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1">{children}</div>;
}

/** Tooltip de los gráficos: el valor lidera, la serie va en gris y lleva una rayita de su color. */
export function TooltipBox({
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
            <span aria-hidden className="h-0.5 w-3 shrink-0 rounded" style={{ background: r.color }} />
          ) : null}
          <span className="text-muted-foreground">{r.label}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export interface ChartTable {
  caption: string;
  head: string[];
  rows: ReactNode[][];
}

/**
 * Tarjeta de un gráfico: el título es la pregunta, el subtítulo la lectura principal, y el gráfico lleva su
 * descripción accesible (`role="img"` + `aria-label` con la lectura) más una tabla alternativa con los valores.
 */
export function ChartCard({
  id,
  title,
  reading,
  legend,
  table,
  note,
  children,
  className,
}: {
  id: string;
  title: string;
  /** La lectura principal en una frase: "Septiembre: $18,3 M, +2 % vs agosto". */
  reading: string;
  legend?: ReactNode;
  table?: ChartTable;
  /** Aclaración de cómo se calcula (letra chica bajo el gráfico). */
  note?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card data-testid={`chart-${id}`} className={cn("min-w-0", className)}>
      <CardContent className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
        <figure className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <figcaption className="grid gap-0.5">
            <h3 className="text-base leading-snug font-semibold">{title}</h3>
            <p className="text-muted-foreground text-sm">{reading}</p>
          </figcaption>
          {legend ? <Legend>{legend}</Legend> : null}
          <div role="img" aria-label={`${title} ${reading}`} className="min-w-0">
            {children}
          </div>
          {note ? <p className="text-muted-foreground text-xs">{note}</p> : null}
          {table ? (
            <details className="text-xs">
              <summary className="text-muted-foreground cursor-pointer">Ver como tabla</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full">
                  <caption className="sr-only">{table.caption}</caption>
                  <thead>
                    <tr className="text-muted-foreground text-left">
                      {table.head.map((h, i) => (
                        <th
                          key={h}
                          scope="col"
                          className={cn("py-1 pr-3 font-medium", i > 0 && "text-right")}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((r, i) => (
                      <tr key={i} className="border-t">
                        {r.map((c, j) => (
                          <td key={j} className={cn("py-1 pr-3", j > 0 && "text-right tabular-nums")}>
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </figure>
      </CardContent>
    </Card>
  );
}

export interface BarRow {
  key: string;
  label: ReactNode;
  /** Texto chico bajo la etiqueta (p. ej. el canal). */
  sub?: string;
  /** Largo de la barra; null = sin dato (no se dibuja). */
  value: number | null;
  /** Texto del valor a la derecha de la barra. */
  valueLabel: string;
  color: string;
  /** Opacidad del color (rampa ordinal de antigüedad). */
  opacity?: number;
  /** Marca sobre la pista (objetivo, punto de pedido), en la misma unidad que `value`. */
  marker?: number | null;
  /** Estado en texto + ícono: el color nunca va solo. */
  flag?: string;
  /** Detalle para el tooltip nativo. */
  title?: string;
}

/**
 * Barras horizontales HTML con la etiqueta arriba de la barra (se leen igual en el celular): el largo mide el valor,
 * el valor se escribe a la derecha, y una marca opcional señala el objetivo. Barras finas con extremo redondeado.
 */
export function BarList({
  rows,
  max,
  markerLabel,
}: {
  rows: BarRow[];
  /** Valor al que llega la pista completa. */
  max: number;
  markerLabel?: string;
}) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <ul className="grid gap-2.5" data-testid="bar-list">
      {rows.map((r) => (
        <li key={r.key} title={r.title} className="grid gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              {r.label}
              {r.sub ? <span className="text-muted-foreground ml-1.5 text-xs">{r.sub}</span> : null}
            </span>
            <span className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
              {r.flag ? (
                <span className="text-xs font-medium" style={{ color: "var(--viz-bad)" }}>
                  <span aria-hidden>▲ </span>
                  {r.flag}
                </span>
              ) : null}
              <span className="font-medium">{r.valueLabel}</span>
            </span>
          </div>
          <div className="relative h-3" aria-hidden>
            <div
              className="absolute inset-0 rounded-sm"
              style={{ background: "var(--viz-grid)", opacity: 0.6 }}
            />
            {r.value != null && r.value > 0 ? (
              <div
                className="absolute inset-y-0 left-0 rounded-r"
                style={{ width: pct(r.value), background: r.color, opacity: r.opacity ?? 1 }}
              />
            ) : null}
            {r.marker != null ? (
              <div
                className="absolute -inset-y-0.5 w-0.5"
                style={{ left: pct(r.marker), background: "var(--viz-ink)" }}
                title={markerLabel}
              />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
