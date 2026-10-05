"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { cn } from "@/lib/utils";

interface Tab {
  href: Route;
  label: string;
  match: (p: string) => boolean;
  /** Solo para quien recibe las rendiciones (Dirección y la jefa). */
  settle?: boolean;
}

const TABS: Tab[] = [
  {
    href: "/despacho",
    label: "Rutas",
    match: (p) => p === "/despacho" || p.startsWith("/despacho/nueva"),
  },
  {
    href: "/despacho/costos" as Route,
    label: "Costo de reparto",
    match: (p) => p.startsWith("/despacho/costos"),
  },
  {
    href: "/despacho/registro" as Route,
    label: "Registro de despacho (BPM)",
    match: (p) => p.startsWith("/despacho/registro"),
  },
  {
    href: "/despacho/rendiciones" as Route,
    label: "Rendiciones",
    match: (p) => p.startsWith("/despacho/rendiciones"),
    settle: true,
  },
];

/** Pestañas del módulo de despacho: cada una es una subruta. */
export function DispatchTabsNav({ canSettle = false }: { canSettle?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones de despacho" className="mb-6 flex gap-1 overflow-x-auto border-b print:hidden">
      {TABS.filter((t) => !t.settle || canSettle).map((t) => {
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
