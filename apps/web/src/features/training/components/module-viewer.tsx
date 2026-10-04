"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TrainingStep } from "../content";
import { RichText } from "./rich-text";

/** Pasos del módulo: captura real con el elemento a tocar resaltado. Flechas ← → del teclado. */
export function ModuleViewer({ steps }: { steps: (TrainingStep & { src: string | null })[] }) {
  const [i, setI] = useState(0);
  const step = steps[i]!;
  const go = (n: number) => setI(Math.min(steps.length - 1, Math.max(0, n)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") setI((v) => Math.min(steps.length - 1, v + 1));
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps.length]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]" data-testid="module-viewer">
      <figure className="grid min-w-0 content-start gap-3">
        {step.src ? (
          <div className="bg-muted relative overflow-hidden rounded-xl border shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={step.src}
              src={step.src}
              alt={`Paso ${i + 1}`}
              className="animate-in fade-in block h-auto w-full duration-300"
            />
            {step.highlight ? (
              <span
                aria-hidden
                className="border-brand-red pointer-events-none absolute animate-[chipa-pulse_1.8s_ease-in-out_infinite] rounded-lg border-[3px] motion-reduce:animate-none"
                style={{
                  left: `calc(${step.highlight.x * 100}% - 4px)`,
                  top: `calc(${step.highlight.y * 100}% - 4px)`,
                  width: `calc(${step.highlight.w * 100}% + 8px)`,
                  height: `calc(${step.highlight.h * 100}% + 8px)`,
                }}
              />
            ) : null}
          </div>
        ) : null}
        <figcaption className="text-lg leading-relaxed" aria-live="polite">
          <span className="text-brand-red mr-2 font-mono font-semibold tabular-nums">
            {i + 1}/{steps.length}
          </span>
          <RichText text={step.text} />
        </figcaption>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => go(i - 1)} disabled={i === 0}>
            <ChevronLeft /> Anterior
          </Button>
          <Button onClick={() => go(i + 1)} disabled={i === steps.length - 1}>
            Siguiente <ChevronRight />
          </Button>
        </div>
      </figure>
      <ol className="grid content-start gap-1" aria-label="Pasos">
        {steps.map((s, n) => (
          <li key={n}>
            <button
              type="button"
              onClick={() => go(n)}
              aria-current={n === i ? "step" : undefined}
              className={cn(
                "hover:bg-muted flex w-full gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                n === i && "bg-secondary text-secondary-foreground",
                n < i && "text-muted-foreground",
              )}
            >
              <span className="font-mono tabular-nums">{n + 1}.</span>
              <span className="line-clamp-2">
                <RichText text={s.text} />
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
