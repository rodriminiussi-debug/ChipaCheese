"use client";

import { useEffect, useState } from "react";
import { ThemeProvider as NextThemes, useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Tema claro / oscuro / del sistema (se recuerda por dispositivo). */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="chipa-theme"
    >
      {children}
    </NextThemes>
  );
}

const OPTIONS = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Noche", icon: Moon },
  { value: "system", label: "Como el dispositivo", icon: Monitor },
] as const;

/** Selector de tema. `compact` = solo ícono (cabeceras); si no, ícono + texto (menú lateral). */
export function ThemeToggle({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { theme = "system", setTheme, resolvedTheme } = useTheme();
  // El tema real se conoce recién en el cliente: evita un ícono distinto entre servidor y cliente.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(t);
  }, []);
  const Icon = mounted && resolvedTheme === "dark" ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={compact ? "secondary" : "ghost"}
          size={compact ? "icon" : "sm"}
          className={cn(!compact && "w-full justify-start", className)}
          aria-label="Cambiar tema"
        >
          <Icon />
          {compact ? null : <span className="group-data-[collapsible=icon]:hidden">Tema</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          {OPTIONS.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              <o.icon className="size-4" /> {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
