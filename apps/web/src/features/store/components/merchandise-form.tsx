"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { NativeSelect } from "@/components/app/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { receiveMerchandiseAction } from "../actions";

interface Line {
  productId: string;
  qty: string;
  cost: string;
}

/**
 * Ingreso de mercadería de reventa en el local (gaseosas, aguas… lo que trae el proveedor):
 * producto, cantidad, costo sin IVA y proveedor opcionales. Suma stock en el LOCAL.
 */
export function MerchandiseForm({
  products,
  suppliers,
}: {
  products: { id: string; name: string; code: string; unitLabel: string }[];
  suppliers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const empty = (): Line => ({ productId: "", qty: "", cost: "" });
  const [lines, setLines] = useState<Line[]>([empty()]);
  const [supplierId, setSupplierId] = useState("");
  const act = useAction(receiveMerchandiseAction, {
    success: (r) =>
      `Ingreso registrado: ${r.items} producto${r.items === 1 ? " sumado" : "s sumados"} al local`,
    onSuccess: () => {
      setLines([empty()]);
      setSupplierId("");
      router.refresh();
    },
  });
  const set = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const valid = lines.every((l) => l.productId && Number(l.qty) > 0);

  if (products.length === 0)
    return (
      <p className="text-muted-foreground text-sm">
        No hay productos de reventa. Dirección los da de alta en Catálogo.
      </p>
    );

  return (
    <form
      className="grid max-w-2xl gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        act.run({
          supplierId: supplierId || null,
          items: lines.map((l) => ({ productId: l.productId, qty: l.qty, unitCostNet: l.cost || null })),
        });
      }}
    >
      <div className="grid gap-3">
        {lines.map((l, i) => (
          <div
            key={i}
            className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_90px_130px_auto] sm:items-end"
          >
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Producto</span>
              <NativeSelect
                className="h-11"
                value={l.productId}
                onChange={(e) => set(i, { productId: e.target.value })}
                aria-label={`Producto ${i + 1}`}
              >
                <option value="">Elegí un producto</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Cantidad</span>
              <Input
                className="h-11"
                inputMode="numeric"
                value={l.qty}
                onChange={(e) => set(i, { qty: e.target.value })}
                aria-label={`Cantidad ${i + 1}`}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Costo unit. sin IVA</span>
              <Input
                className="h-11"
                inputMode="decimal"
                placeholder="Opcional"
                value={l.cost}
                onChange={(e) => set(i, { cost: e.target.value })}
                aria-label={`Costo ${i + 1}`}
              />
            </label>
            {lines.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Quitar la línea ${i + 1}`}
                onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}
              >
                <Trash2 />
              </Button>
            ) : null}
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, empty()])}>
            <Plus /> Agregar otro producto
          </Button>
        </div>
      </div>
      <label className="grid max-w-sm gap-1 text-sm">
        <span className="font-medium">Proveedor (opcional)</span>
        <NativeSelect className="h-11" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Sin indicar</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      </label>
      <div>
        <Button type="submit" size="lg" className="h-12" disabled={act.pending || !valid}>
          Ingresar al local
        </Button>
      </div>
    </form>
  );
}
