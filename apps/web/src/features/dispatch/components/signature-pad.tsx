"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SignaturePadHandle {
  isEmpty: () => boolean;
  /** La firma como PNG (fondo blanco), lista para subir. */
  toFile: () => Promise<File | null>;
  clear: () => void;
}

/** RF-25: firma dibujada con el dedo o el mouse. Se guarda como PNG. */
export function SignaturePad({ padRef, label }: { padRef: Ref<SignaturePadHandle>; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const inkRef = useRef(false);

  function paintBackground() {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  useEffect(() => {
    paintBackground();
  }, []);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    // Un toque suelto también deja un punto.
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
    inkRef.current = true;
    setHasInk(true);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function end() {
    drawing.current = false;
  }
  function clear() {
    paintBackground();
    inkRef.current = false;
    setHasInk(false);
  }

  useImperativeHandle(padRef, () => ({
    isEmpty: () => !inkRef.current,
    clear,
    toFile: () =>
      new Promise<File | null>((resolve) => {
        const c = canvas.current;
        if (!c || !inkRef.current) return resolve(null);
        c.toBlob(
          (blob) => resolve(blob ? new File([blob], "firma.png", { type: "image/png" }) : null),
          "image/png",
        );
      }),
  }));

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={!hasInk}>
          <Eraser /> Borrar
        </Button>
      </div>
      <canvas
        ref={canvas}
        width={640}
        height={240}
        aria-label="Espacio para firmar"
        data-testid="signature-canvas"
        className="w-full touch-none rounded-md border bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </div>
  );
}
