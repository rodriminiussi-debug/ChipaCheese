"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { cn } from "@/lib/utils";

/** Pestañas de cobranzas (oficina). Se ocultan en la pantalla de ruta del chofer. */
export function BillingTabs({ showImport }: { showImport: boolean }) {
  const pathname = usePathname();
  if (pathname.startsWith("/cobranzas/ruta")) return null;
  const tabs: { href: Route; label: string; active: boolean }[] = [
    {
      href: "/cobranzas",
      label: "Cuentas corrientes",
      active: pathname === "/cobranzas" || pathname.startsWith("/cobranzas/clientes"),
    },
    {
      href: "/cobranzas/cheques" as Route,
      label: "Cheques",
      active: pathname.startsWith("/cobranzas/cheques"),
    },
    ...(showImport
      ? [
          {
            href: "/cobranzas/importar" as Route,
            label: "Importar ARCA",
            active: pathname.startsWith("/cobranzas/importar"),
          },
        ]
      : []),
  ];
  return (
    <nav aria-label="Secciones de cobranzas" className="mb-6 flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
            t.active
              ? "border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
