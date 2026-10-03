"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { cn } from "@/lib/utils";

const TABS: { href: Route; label: string; match: (p: string) => boolean }[] = [
  { href: "/calidad", label: "Registros", match: (p) => p === "/calidad" },
  {
    href: "/calidad/reclamos" as Route,
    label: "Reclamos y devoluciones",
    match: (p) => p.startsWith("/calidad/reclamos"),
  },
  {
    href: "/calidad/trazabilidad" as Route,
    label: "Trazabilidad",
    match: (p) => p.startsWith("/calidad/trazabilidad"),
  },
  {
    href: "/calidad/exportar" as Route,
    label: "Exportar para ASSAL",
    match: (p) => p.startsWith("/calidad/exportar"),
  },
];

/** Pestañas del módulo de calidad: cada una es una subruta. */
export function QualityTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones de calidad" className="mb-6 flex gap-1 overflow-x-auto border-b print:hidden">
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
