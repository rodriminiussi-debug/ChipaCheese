/* eslint-disable @next/next/no-img-element -- logos estáticos livianos; next/image no aporta acá */
import { cn } from "@/lib/utils";

/** Logo completo de Chipa Cheese (chipacheese.com.ar): isotipo + "CHIPA cheese". */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <img
      src="/brand/logo.png"
      alt="Chipa Cheese"
      width={640}
      height={282}
      className={cn("h-auto w-40", className)}
    />
  );
}

/** Isotipo: el queso con anteojos. */
export function BrandMark({ className, alt = "" }: { className?: string; alt?: string }) {
  return (
    <img src="/brand/isotipo.png" alt={alt} width={300} height={300} className={cn("size-8", className)} />
  );
}
