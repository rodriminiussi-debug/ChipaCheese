import Link from "next/link";
import type { Route } from "next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths } from "@chipa/domain";
import { Button } from "@/components/ui/button";

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function monthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} de ${y}`;
}

/** Navegación mes anterior / siguiente por query string (`?mes=YYYY-MM`), conservando `extra`. */
export function MonthNav({
  basePath,
  month,
  extra = {},
}: {
  basePath: string;
  month: string;
  extra?: Record<string, string>;
}) {
  const href = (m: string) => {
    const qs = new URLSearchParams({ ...extra, mes: m });
    return `${basePath}?${qs}` as Route;
  };
  const prev = addMonths(`${month}-01`, -1).slice(0, 7);
  const next = addMonths(`${month}-01`, 1).slice(0, 7);
  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="outline" size="icon" aria-label="Mes anterior">
        <Link href={href(prev)}>
          <ChevronLeft />
        </Link>
      </Button>
      <span className="min-w-40 text-center font-medium capitalize" data-testid="month-label">
        {monthLabel(month)}
      </span>
      <Button asChild variant="outline" size="icon" aria-label="Mes siguiente">
        <Link href={href(next)}>
          <ChevronRight />
        </Link>
      </Button>
    </div>
  );
}

/** Mes de la query (`YYYY-MM` válido) o el actual. */
export function parseMonth(raw: string | string[] | undefined, today: string) {
  const v = typeof raw === "string" ? raw : undefined;
  return v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : today.slice(0, 7);
}
