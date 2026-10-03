"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { cn } from "@/lib/utils";

const TABS: { href: Route; label: string; match: (p: string) => boolean }[] = [
  { href: "/costos", label: "Costo por producto", match: (p) => p === "/costos" },
  { href: "/costos/gastos" as Route, label: "Gastos fijos", match: (p) => p.startsWith("/costos/gastos") },
  {
    href: "/costos/resultado" as Route,
    label: "Resultado mensual",
    match: (p) => p.startsWith("/costos/resultado"),
  },
];

/** Pestañas de Gastos y costeo (M8). */
export function FinanceTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones de gastos y costeo" className="mb-6 flex gap-1 overflow-x-auto border-b">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
