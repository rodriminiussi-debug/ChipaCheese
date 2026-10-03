"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, ShoppingBasket, Trash2 } from "lucide-react";
import { formatARS, roundMoney } from "@chipa/domain";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { createStoreSaleAction } from "../actions";
import { STORE_METHOD_OPTIONS } from "../labels";
import type { StoreProduct } from "../service";

/**
 * RF-33: punto de venta simple para tablet o celular. Botones grandes por producto, cantidades +/−,
 * medio de pago y total. El precio es el de la lista del canal local; el stock, el de la ubicación LOCAL.
 */
export function StorePos({ products }: { products: StoreProduct[] }) {
  const router = useRouter();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<"cash" | "transfer">("cash");
  const act = useAction(createStoreSaleAction, {
    success: (r) => `Venta registrada: ${formatARS(r.total)}`,
    onSuccess: () => {
      setCart({});
      router.refresh();
    },
  });

  const lines = products.filter((p) => (cart[p.productId] ?? 0) > 0);
  const total = roundMoney(lines.reduce((a, p) => a + p.price * (cart[p.productId] ?? 0), 0));
  const units = lines.reduce((a, p) => a + (cart[p.productId] ?? 0), 0);
  const noStock = products.every((p) => p.stock <= 0);

  const change = (p: StoreProduct, delta: number) =>
    setCart((c) => {
      const next = Math.max(0, Math.min(p.stock, (c[p.productId] ?? 0) + delta));
      const copy = { ...c };
      if (next > 0) copy[p.productId] = next;
      else delete copy[p.productId];
      return copy;
    });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <section aria-label="Productos" className="grid gap-3">
        {noStock ? (
          <p role="status" className="rounded-lg border border-dashed p-4 text-sm">
            No hay stock en el local. Pasá producto desde F3 o F4 en Stock › Producto terminado (Transferir).
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {products.map((p) => {
            const inCart = cart[p.productId] ?? 0;
            const disabled = p.stock - inCart <= 0;
            return (
              <button
                key={p.productId}
                type="button"
                aria-label={`Agregar ${p.name}`}
                disabled={disabled}
                onClick={() => change(p, 1)}
                className={cn(
                  "bg-card relative flex min-h-28 flex-col justify-between rounded-xl border p-3 text-left transition-colors",
                  "hover:bg-accent focus-visible:ring-ring focus-visible:ring-3 focus-visible:outline-none",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  inCart > 0 && "border-primary ring-primary/30 ring-2",
                )}
              >
                <span className="text-base leading-tight font-semibold">{p.name}</span>
                <span>
                  <span className="block text-lg font-semibold tabular-nums">{formatARS(p.price)}</span>
                  <span
                    className={cn("text-xs", p.stock <= 0 ? "text-destructive" : "text-muted-foreground")}
                  >
                    {p.stock <= 0 ? "Sin stock en el local" : `${p.stock} en el local`}
                  </span>
                </span>
                {inCart > 0 ? (
                  <span className="bg-primary text-primary-foreground absolute top-2 right-2 grid size-7 place-items-center rounded-full text-sm font-semibold">
                    {inCart}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      <section aria-label="Venta actual" className="bg-card grid h-fit gap-4 rounded-xl border p-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShoppingBasket className="size-5" /> Venta actual
        </h2>
        {lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">Tocá un producto para agregarlo.</p>
        ) : (
          <ul className="grid gap-3" aria-label="Productos de la venta">
            {lines.map((p) => (
              <li key={p.productId} className="grid gap-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{p.name}</span>
                  <span className="tabular-nums">{formatARS(p.price * (cart[p.productId] ?? 0))}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11"
                    aria-label={`Quitar una unidad de ${p.name}`}
                    onClick={() => change(p, -1)}
                  >
                    <Minus />
                  </Button>
                  <span
                    className="w-10 text-center text-lg font-semibold tabular-nums"
                    aria-label={`Cantidad de ${p.name}`}
                  >
                    {cart[p.productId]}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11"
                    aria-label={`Sumar una unidad de ${p.name}`}
                    disabled={(cart[p.productId] ?? 0) >= p.stock}
                    onClick={() => change(p, 1)}
                  >
                    <Plus />
                  </Button>
                  <span className="text-muted-foreground text-xs">{formatARS(p.price)} c/u</span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div role="radiogroup" aria-label="Medio de pago" className="grid grid-cols-2 gap-2">
          {STORE_METHOD_OPTIONS.map((m) => (
            <Button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={method === m.value}
              variant={method === m.value ? "default" : "outline"}
              className="h-12 text-base"
              onClick={() => setMethod(m.value)}
            >
              {m.label}
            </Button>
          ))}
        </div>

        <div className="flex items-end justify-between border-t pt-3">
          <span className="text-muted-foreground text-sm">
            Total · {units} unidad{units === 1 ? "" : "es"}
          </span>
          <span className="text-3xl font-semibold tabular-nums" data-testid="pos-total">
            {formatARS(total)}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-14"
            disabled={lines.length === 0}
            aria-label="Vaciar la venta"
            onClick={() => setCart({})}
          >
            <Trash2 />
          </Button>
          <Button
            type="button"
            className="h-14 flex-1 text-lg"
            disabled={lines.length === 0 || act.pending}
            onClick={() =>
              act.run({
                method,
                items: lines.map((p) => ({ productId: p.productId, qtyUnits: cart[p.productId]! })),
              })
            }
          >
            Cobrar {total > 0 ? formatARS(total) : ""}
          </Button>
        </div>
      </section>
    </div>
  );
}
