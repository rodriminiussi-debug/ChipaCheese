import Link from "next/link";
import type { Route } from "next";
import { DateText } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { RUN_STATUS, SHIFT } from "../labels";

/** Lista de producciones abiertas con botones grandes (modo planta). `basePath` recibe `?id=<producción>`. */
export function PlantRunPicker({
  runs,
  basePath,
}: {
  runs: { id: string; runNumber: number; date: string; shift: string; status: string }[];
  basePath: string;
}) {
  return (
    <div className="grid gap-3" aria-label="Producciones abiertas">
      {runs.map((r) => {
        const status = RUN_STATUS[r.status]!;
        return (
          <Link
            key={r.id}
            href={`${basePath}?id=${r.id}` as Route}
            className="bg-card hover:bg-accent flex min-h-20 items-center justify-between gap-3 rounded-xl border p-4 text-xl font-semibold shadow-sm"
          >
            <span>
              Producción N° {r.runNumber} · <DateText value={r.date} />
              <span className="text-muted-foreground block text-base font-normal">{SHIFT[r.shift]}</span>
            </span>
            <StatusBadge tone={status.tone} className="px-3 py-1 text-base">
              {status.label}
            </StatusBadge>
          </Link>
        );
      })}
    </div>
  );
}
