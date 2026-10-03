import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Select nativo con el estilo de los inputs. En tablet abre el selector del sistema (más fácil con guantes)
 * y es accesible por defecto (`getByRole("combobox")`, `selectOption`).
 */
export function NativeSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(
          "border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full appearance-none rounded-lg border py-1 pr-8 pl-2.5 text-sm shadow-xs outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2" />
    </div>
  );
}
