"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { cn } from "@/lib/utils";

const TABS: { href: Route; label: string }[] = [
  { href: "/compras", label: "Resumen" },
  { href: "/compras/facturas", label: "Facturas" },
  { href: "/compras/ordenes", label: "Órdenes de compra" },
  { href: "/compras/recepciones", label: "Recepciones" },
  { href: "/compras/precios", label: "Precios" },
  { href: "/compras/cuentas", label: "Cuentas corrientes" },
];

/** Sub-navegación del módulo de compras (M2). */
export function ComprasNav() {
  const pathname = usePathname();
  const active = (href: string) => (href === "/compras" ? pathname === href : pathname.startsWith(href));
  return (
    <nav
      aria-label="Compras"
      className="-mx-4 mb-6 overflow-x-auto border-b px-4 md:mx-0 md:px-0 print:hidden"
    >
      <ul className="flex min-w-max gap-1">
        {TABS.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={active(t.href) ? "page" : undefined}
              className={cn(
                "inline-block border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap",
                active(t.href)
                  ? "border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
