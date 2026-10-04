"use client";

import { useEffect, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Trazabilidad de un lote (RF-35): desde el QR de la etiqueta, hacia atrás (producción → lotes de
 * materia prima → proveedores) y hacia adelante (remitos → clientes, local y stock). Ejemplo ilustrativo.
 */
type NodeKind = "lot" | "run" | "raw" | "out";
interface TNode {
  id: string;
  x: number;
  y: number;
  kind: NodeKind;
  title: string;
  sub: string;
  /** Orden de aparición (0 = el lote). */
  order: number;
}

const NODES: TNode[] = [
  { id: "lot", x: 480, y: 210, kind: "lot", title: "Lote 261001-1", sub: "vence 01/04/2027", order: 0 },
  {
    id: "run",
    x: 285,
    y: 210,
    kind: "run",
    title: "Producción N° 1",
    sub: "01/10 · A.F. · 149,3 kg",
    order: 1,
  },
  {
    id: "fec",
    x: 95,
    y: 90,
    kind: "raw",
    title: "Fécula FEC-2609",
    sub: "Leo Pelle · vence 30/06/2027",
    order: 2,
  },
  {
    id: "tybo",
    x: 95,
    y: 210,
    kind: "raw",
    title: "Queso TYBO-0925",
    sub: "Leo Pelle · recibido a 4 °C",
    order: 2,
  },
  {
    id: "lec",
    x: 95,
    y: 330,
    kind: "raw",
    title: "Leche LEC-0928",
    sub: "Cotar · vence 12/10/2026",
    order: 2,
  },
  { id: "c1", x: 795, y: 70, kind: "out", title: "La Reina", sub: "Remito R-0201 · 120 bolsas", order: 3 },
  { id: "c2", x: 795, y: 165, kind: "out", title: "Vía Dolce", sub: "Remito R-0207 · 30 bolsas", order: 3 },
  { id: "c3", x: 795, y: 260, kind: "out", title: "Local", sub: "Venta mostrador · 18 bolsas", order: 3 },
  { id: "c4", x: 795, y: 355, kind: "out", title: "Stock F3", sub: "40 bolsas · se puede retener", order: 3 },
];
const EDGES: [string, string][] = [
  ["lot", "run"],
  ["run", "fec"],
  ["run", "tybo"],
  ["run", "lec"],
  ["lot", "c1"],
  ["lot", "c2"],
  ["lot", "c3"],
  ["lot", "c4"],
];
const W = 170;
const H = 58;

export function TraceAnimation() {
  // En reposo se ve el recorrido completo (etapa 3); "Repetir" lo vuelve a dibujar paso a paso.
  const [stage, setStage] = useState(3);
  const running = stage < 3;

  useEffect(() => {
    if (stage >= 3) return;
    const t = setTimeout(() => setStage((s) => s + 1), 900);
    return () => clearTimeout(t);
  }, [stage]);

  const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
  const visible = (n: TNode) => n.order <= stage;

  return (
    <section aria-label="Trazabilidad de un lote" className="grid gap-4" data-testid="trace">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setStage(0)} disabled={running}>
          {stage >= 3 ? <RotateCcw /> : <Play />}
          {stage >= 3 ? "Repetir" : "Trazando…"}
        </Button>
        <p className="text-muted-foreground text-sm">
          Escaneás el QR de la bolsa →{" "}
          <span className="text-foreground font-semibold">resuelto en 0,3 s</span>{" "}
          <span className="whitespace-nowrap">(antes: más de 15 minutos con planillas)</span>
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <svg
          viewBox="0 0 980 420"
          className="block w-full min-w-[640px]"
          role="img"
          aria-labelledby="trace-title"
        >
          <title id="trace-title">
            El lote 261001-1 se traza hacia atrás hasta la producción, los lotes de fécula, queso y leche y
            sus proveedores, y hacia adelante hasta los clientes, el local y el stock.
          </title>
          <text
            x="95"
            y="28"
            textAnchor="middle"
            className="fill-muted-foreground text-[12px] font-semibold tracking-wide uppercase"
          >
            Hacia atrás
          </text>
          <text
            x="795"
            y="28"
            textAnchor="middle"
            className="fill-muted-foreground text-[12px] font-semibold tracking-wide uppercase"
          >
            Hacia adelante
          </text>
          {EDGES.map(([a, b]) => {
            const na = byId[a]!;
            const nb = byId[b]!;
            const show = visible(nb);
            const x1 = na.x + (nb.x > na.x ? W / 2 : -W / 2);
            const x2 = nb.x + (nb.x > na.x ? -W / 2 : W / 2);
            const mx = (x1 + x2) / 2;
            return (
              <path
                key={`${a}-${b}`}
                d={`M${x1},${na.y} C${mx},${na.y} ${mx},${nb.y} ${x2},${nb.y}`}
                pathLength={1}
                className={cn(
                  "fill-none stroke-[2.5] transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none",
                  nb.kind === "raw" || nb.kind === "run" ? "stroke-chart-4" : "stroke-brand-red",
                )}
                strokeDasharray="1"
                strokeDashoffset={show ? 0 : 1}
              />
            );
          })}
          {NODES.map((n) => (
            <g
              key={n.id}
              className={cn(
                "transition-opacity duration-500 motion-reduce:transition-none",
                visible(n) ? "opacity-100" : "opacity-0",
              )}
            >
              <rect
                x={n.x - W / 2}
                y={n.y - H / 2}
                width={W}
                height={H}
                rx={10}
                className={cn(
                  "stroke-[1.5]",
                  n.kind === "lot" ? "fill-brand-yellow stroke-brand-ink" : "fill-card stroke-border",
                )}
              />
              <text
                x={n.x}
                y={n.y - 5}
                textAnchor="middle"
                className="fill-foreground font-mono text-[13px] font-semibold"
                style={n.kind === "lot" ? { fill: "var(--color-brand-ink)" } : undefined}
              >
                {n.title}
              </text>
              <text
                x={n.x}
                y={n.y + 15}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px]"
                style={n.kind === "lot" ? { fill: "var(--color-brand-ink)" } : undefined}
              >
                {n.sub}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p className="text-muted-foreground max-w-prose text-sm">
        Si un cliente reclama, desde la misma pantalla se puede{" "}
        <strong className="text-foreground">retener el lote</strong>: deja de salir en los remitos hasta que
        calidad lo libere.
      </p>
    </section>
  );
}
