"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { cn } from "@/lib/utils";

const TABS: { href: Route; label: string; match: (p: string) => boolean }[] = [
  {
    href: "/stock",
    label: "Materia prima",
    match: (p) => p === "/stock" || p.startsWith("/stock/insumos"),
  },
  {
    href: "/stock/producto-terminado" as Route,
    label: "Producto terminado",
    match: (p) => p.startsWith("/stock/producto-terminado"),
  },
  {
    href: "/stock/reposicion" as Route,
    label: "Reposición del local",
    match: (p) => p.startsWith("/stock/reposicion"),
  },
  {
    href: "/stock/movimientos" as Route,
    label: "Movimientos",
    match: (p) => p.startsWith("/stock/movimientos"),
  },
  {
    href: "/stock/inventario" as Route,
    label: "Inventario",
    match: (p) => p.startsWith("/stock/inventario"),
  },
  {
    href: "/stock/simulador" as Route,
    label: "Simulador",
    match: (p) => p.startsWith("/stock/simulador"),
  },
];

/** Pestañas del módulo de stock: cada una es una subruta (se puede compartir el link). */
export function StockTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones de stock" className="mb-6 flex gap-1 overflow-x-auto border-b">
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
