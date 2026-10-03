"use client";

import { useState } from "react";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Campo "Escanear lote" (RF-11): los lectores de QR USB/Bluetooth tipean el contenido como un teclado y
 * terminan con Enter. `onScan` recibe el texto leído y devuelve el mensaje a mostrar (o null si no hay nada
 * para decir); `ok` indica si el lote se seleccionó.
 */
export function LotScanField({ onScan }: { onScan: (text: string) => { ok: boolean; message: string } }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function submit() {
    if (!text.trim()) return;
    setResult(onScan(text));
    setText("");
  }

  return (
    <div className="grid gap-1">
      <label className="grid gap-1 text-sm font-medium">
        Escanear lote
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault(); // el lector manda Enter: no debe enviar el formulario
                submit();
              }
            }}
            placeholder="Apuntá el lector al QR de la etiqueta del lote"
            autoComplete="off"
            className="max-w-md"
          />
          <Button type="button" variant="outline" onClick={submit}>
            <ScanLine /> Seleccionar
          </Button>
        </div>
      </label>
      <p
        role="status"
        aria-live="polite"
        className={
          result == null
            ? "sr-only"
            : result.ok
              ? "text-sm text-emerald-700 dark:text-emerald-400"
              : "text-sm text-amber-700 dark:text-amber-400"
        }
      >
        {result?.message}
      </p>
    </div>
  );
}
