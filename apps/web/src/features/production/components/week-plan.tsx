import Link from "next/link";
import { isoWeekday } from "@chipa/domain";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText } from "@/components/app/format";
import { WEEKDAY_LABELS } from "@/lib/dates";
import { capacityUsage } from "../calc";
import { fmtQty } from "../format";
import { PLAN_STATUS } from "../labels";
import type { weekPlan } from "../service";

const BAR: Record<string, string> = {
  neutral: "",
  good: "",
  warn: "[&_[data-slot=progress-indicator]]:bg-amber-500",
  bad: "[&_[data-slot=progress-indicator]]:bg-destructive",
};

/** Vista semanal (RF-19): kg planificados por día contra la capacidad del abatidor. */
export function WeekPlan({
  days,
  capacityKg,
  today,
  selected,
}: {
  days: Awaited<ReturnType<typeof weekPlan>>;
  capacityKg: number;
  today: string;
  selected: string;
}) {
  return (
    <ul className="grid gap-3" aria-label="Plan semanal">
      {days.map((d) => {
        const usage = capacityUsage(d.plannedKg, capacityKg);
        const status = d.planStatus ? PLAN_STATUS[d.planStatus] : null;
        return (
          <li
            key={d.date}
            className="grid items-center gap-2 sm:grid-cols-[8rem_1fr_11rem]"
            data-testid={`week-${d.date}`}
          >
            <Link
              href={`/produccion?fecha=${d.date}`}
              className={`text-sm hover:underline ${d.date === selected ? "font-semibold" : ""}`}
            >
              {WEEKDAY_LABELS[isoWeekday(d.date)]} <DateText value={d.date} />
              {d.date === today ? <span className="text-primary ml-1">· hoy</span> : null}
            </Link>
            <div className="grid gap-1">
              <Progress
                value={Math.min(100, usage.pct)}
                className={`h-2.5 ${BAR[usage.tone]}`}
                aria-label={`Uso de capacidad del ${d.date}`}
              />
              <span className="text-muted-foreground text-xs tabular-nums">
                {fmtQty(d.plannedKg, 1)} de {fmtQty(capacityKg)} kg · {usage.pct} %
                {d.runs
                  ? ` · ${d.runs} producción${d.runs > 1 ? "es" : ""}, ${fmtQty(d.weighedKg, 1)} kg pesados`
                  : ""}
              </span>
            </div>
            <div className="sm:text-right">
              {status ? (
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              ) : (
                <span className="text-muted-foreground text-xs">Sin plan</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
