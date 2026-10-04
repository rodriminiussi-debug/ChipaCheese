import { cn } from "@/lib/utils";

export function ProgressBar({ done, total, className }: { done: number; total: number; className?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className={cn("grid gap-1", className)}>
      <div
        className="bg-muted h-2 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={`${done} de ${total} módulos aprobados`}
      >
        <div
          className="bg-brand-red h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-muted-foreground text-xs tabular-nums">
        {done} de {total} módulos aprobados
      </span>
    </div>
  );
}
