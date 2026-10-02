import { formatARS, formatDateAR, formatKg, formatNumber } from "@chipa/domain";
import { cn } from "@/lib/utils";

/** Componentes de formato argentino (es-AR). Server y client safe. */
export function Money({
  value,
  className,
  decimals,
}: {
  value: number | null | undefined;
  className?: string;
  decimals?: number;
}) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("tabular-nums", value < 0 && "text-destructive", className)}>
      {formatARS(value, decimals != null ? { decimals } : undefined)}
    </span>
  );
}

export function Kg({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return <span className={cn("tabular-nums", className)}>{formatKg(value)}</span>;
}

export function Num({
  value,
  decimals = 2,
  suffix,
  className,
}: {
  value: number | null | undefined;
  decimals?: number;
  suffix?: string;
  className?: string;
}) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("tabular-nums", className)}>
      {formatNumber(value, decimals)}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

export function DateText({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <span className="tabular-nums">{formatDateAR(value)}</span>;
}

const UNIT_LABEL = { kg: "kg", l: "L", unit: "u." } as const;
export const unitLabel = (u: keyof typeof UNIT_LABEL) => UNIT_LABEL[u];
