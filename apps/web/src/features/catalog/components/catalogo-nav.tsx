"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { cn } from "@/lib/utils";

const TABS: { href: string; label: string }[] = [
  { href: "/catalogo/productos", label: "Productos" },
  { href: "/catalogo/insumos", label: "Insumos" },
  { href: "/catalogo/zonas", label: "Zonas de reparto" },
  { href: "/catalogo/listas", label: "Listas de precios" },
  { href: "/catalogo/vehiculos", label: "Vehículos" },
  { href: "/catalogo/equipos", label: "Equipos" },
  { href: "/catalogo/ubicaciones", label: "Ubicaciones" },
];

/** Sub-navegación del catálogo editable. */
export function CatalogoNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Catálogo"
      className="-mx-4 mb-6 overflow-x-auto border-b px-4 md:mx-0 md:px-0 print:hidden"
    >
      <ul className="flex min-w-max gap-1">
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href as Route}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-block border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap",
                  active
                    ? "border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
