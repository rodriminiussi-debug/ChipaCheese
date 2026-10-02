"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Estilos de impresión de la página: oculta el menú y define el tamaño del papel (A4, etiqueta 100×60 mm…). */
export function PrintStyles({ pageSize, margin = "0" }: { pageSize: string; margin?: string }) {
  return (
    <style>{`
      @media print {
        @page { size: ${pageSize}; margin: ${margin}; }
        [data-slot="sidebar"], [data-slot="sidebar-inset"] > header { display: none !important; }
        [data-slot="sidebar-inset"] > div { padding: 0 !important; max-width: none !important; margin: 0 !important; }
        body { background: #fff !important; }
      }
    `}</style>
  );
}

export function PrintButton({ label = "Imprimir" }: { label?: string }) {
  return (
    <Button type="button" onClick={() => window.print()} className="print:hidden">
      <Printer /> {label}
    </Button>
  );
}
