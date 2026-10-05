"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, ScanBarcode, Search, ShoppingBasket, Trash2, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { formatARS, parseDecimalAR, roundMoney } from "@chipa/domain";
import { NativeSelect } from "@/components/app/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { createStoreSaleAction } from "../actions";
import { STORE_METHOD_OPTIONS } from "../labels";
import type { StoreMethod } from "../schemas";
import type { StoreCustomer, StoreProduct } from "../service";

const EPS = 1e-9;

/**
 * RF-33: punto de venta para celular, tablet o PC. Todos los productos del local (chipá, reventa y elaborados),
 * búsqueda y lector de código de barras (tipea el código + Enter y suma 1), cliente opcional para la venta
 * mayorista, cuatro medios de pago y pago dividido en dos medios.
 * El precio es el de la lista del local (o el de la lista del cliente); el stock, el de la ubicación LOCAL.
 * Un elaborado comparte el stock de su producto base: el límite se calcula por producto base.
 */
export function StorePos({
  products,
  poolStock,
  customers,
}: {
  products: StoreProduct[];
  poolStock: Record<string, number>;
  customers: StoreCustomer[];
}) {
  const router = useRouter();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<StoreMethod>("cash");
  const [split, setSplit] = useState(false);
  const [method2, setMethod2] = useState<StoreMethod>("card");
  const [amount1, setAmount1] = useState("");
  const [query, setQuery] = useState("");
  const [scan, setScan] = useState("");
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customer, setCustomer] = useState<StoreCustomer | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setCart({});
    setSplit(false);
    setAmount1("");
    setMethod("cash");
    setCustomer(null);
    setCustomerQuery("");
  };
  const act = useAction(createStoreSaleAction, {
    success: (r) => `Venta registrada: ${formatARS(r.total)}`,
    onSuccess: () => {
      reset();
      router.refresh();
    },
  });

  const priceOf = (p: StoreProduct) => customer?.prices[p.productId] ?? p.price;
  const lines = products.filter((p) => (cart[p.productId] ?? 0) > 0);
  const total = roundMoney(lines.reduce((a, p) => a + priceOf(p) * (cart[p.productId] ?? 0), 0));
  const units = lines.reduce((a, p) => a + (cart[p.productId] ?? 0), 0);
  const noStock = products.every((p) => p.stock <= 0);

  /** Cuántas unidades más se pueden agregar de `p`, descontando lo que ya consume el carrito del mismo stock. */
  const room = (p: StoreProduct, c: Record<string, number> = cart) => {
    const used = products
      .filter((q) => q.poolId === p.poolId)
      .reduce((a, q) => a + (c[q.productId] ?? 0) * q.consume, 0);
    return Math.max(0, Math.floor(((poolStock[p.poolId] ?? 0) - used) / p.consume + EPS));
  };

  const add = (p: StoreProduct, delta: number) =>
    setCart((c) => {
      const cur = c[p.productId] ?? 0;
      const next = delta > 0 ? cur + Math.min(delta, room(p, c)) : Math.max(0, cur + delta);
      const copy = { ...c };
      if (next > 0) copy[p.productId] = next;
      else delete copy[p.productId];
      return copy;
    });

  const normalized = query.trim().toLowerCase();
  const shown = normalized
    ? products.filter((p) =>
        [p.name, p.code, p.barcode ?? ""].some((x) => x.toLowerCase().includes(normalized)),
      )
    : products;

  function onScan(e: React.FormEvent) {
    e.preventDefault();
    const code = scan.trim();
    if (!code) return;
    const p = products.find((x) => x.barcode === code || x.code.toLowerCase() === code.toLowerCase());
    setScan("");
    if (!p) {
      setScanMsg({ ok: false, text: `No hay ningún producto con el código ${code}.` });
      toast.error(`No hay ningún producto con el código ${code}.`);
    } else if (room(p) <= 0) {
      setScanMsg({ ok: false, text: `No hay más stock de ${p.name} en el local.` });
      toast.error(`No hay más stock de ${p.name} en el local.`);
    } else {
      add(p, 1);
      setScanMsg({ ok: true, text: `Agregado: ${p.name}` });
    }
    scanRef.current?.focus();
  }

  // Pago dividido.
  const first = parseDecimalAR(amount1);
  const firstAmount = first != null && first > 0 ? roundMoney(first) : null;
  const remainder = firstAmount == null ? null : roundMoney(total - firstAmount);
  const splitError = !split
    ? null
    : method === method2
      ? "Elegí dos medios distintos."
      : firstAmount == null
        ? "Indicá cuánto se paga con el primer medio."
        : remainder! <= 0
          ? "El primer monto tiene que ser menor al total."
          : null;
  const canCharge = lines.length > 0 && !act.pending && !splitError;

  function charge() {
    act.run({
      customerId: customer?.id ?? null,
      items: lines.map((p) => ({ productId: p.productId, qtyUnits: cart[p.productId]! })),
      payments: split
        ? [
            { method, amount: firstAmount },
            { method: method2, amount: remainder },
          ]
        : [{ method }],
    });
  }

  const customerResults =
    customerQuery.trim().length >= 2 && !customer
      ? customers.filter((c) => c.name.toLowerCase().includes(customerQuery.trim().toLowerCase())).slice(0, 6)
      : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
      <section aria-label="Productos" className="grid content-start gap-3">
        {noStock ? (
          <p role="status" className="rounded-lg border border-dashed p-4 text-sm">
            No hay stock en el local. Pedí reposición a la planta (arriba) o ingresá la mercadería de reventa.
          </p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <form onSubmit={onScan} className="grid gap-1">
            <label htmlFor="pos-barcode" className="flex items-center gap-1.5 text-sm font-medium">
              <ScanBarcode className="size-4" /> Código de barras
            </label>
            <Input
              id="pos-barcode"
              ref={scanRef}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder="Escaneá o escribí el código y Enter"
              className="h-11"
            />
            <p
              role="status"
              className={cn(
                "min-h-4 text-xs",
                scanMsg?.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive",
              )}
            >
              {scanMsg?.text ?? ""}
            </p>
          </form>
          <div className="grid content-start gap-1">
            <label htmlFor="pos-search" className="flex items-center gap-1.5 text-sm font-medium">
              <Search className="size-4" /> Buscar producto
            </label>
            <Input
              id="pos-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              placeholder="Nombre o código"
              className="h-11"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shown.map((p) => {
            const inCart = cart[p.productId] ?? 0;
            const left = room(p);
            const disabled = left <= 0;
            return (
              <button
                key={p.productId}
                type="button"
                aria-label={`Agregar ${p.name}`}
                disabled={disabled}
                onClick={() => add(p, 1)}
                className={cn(
                  "bg-card relative flex min-h-28 flex-col justify-between rounded-xl border p-3 text-left transition-colors",
                  "hover:bg-accent focus-visible:ring-ring focus-visible:ring-3 focus-visible:outline-none",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  inCart > 0 && "border-primary ring-primary/30 ring-2",
                )}
              >
                <span className="text-base leading-tight font-semibold">{p.name}</span>
                <span>
                  <span className="block text-lg font-semibold tabular-nums">{formatARS(priceOf(p))}</span>
                  <span
                    className={cn("text-xs", p.stock <= 0 ? "text-destructive" : "text-muted-foreground")}
                  >
                    {p.stock <= 0
                      ? p.kind === "prepared"
                        ? "Sin stock del producto base"
                        : "Sin stock en el local"
                      : p.kind === "prepared"
                        ? `Alcanza para ${p.stock}`
                        : `${p.stock} en el local`}
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
          {shown.length === 0 ? (
            <p className="text-muted-foreground col-span-full text-sm">
              Ningún producto coincide con la búsqueda.
            </p>
          ) : null}
        </div>
      </section>

      <section aria-label="Venta actual" className="bg-card grid h-fit gap-4 rounded-xl border p-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShoppingBasket className="size-5" /> Venta actual
        </h2>

        <div className="grid gap-1">
          <label htmlFor="pos-customer" className="flex items-center gap-1.5 text-sm font-medium">
            <UserRound className="size-4" /> Cliente (venta mayorista, opcional)
          </label>
          {customer ? (
            <div className="bg-muted flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm">
              <span>
                <strong>{customer.name}</strong>
                <span className="text-muted-foreground block text-xs">
                  {Object.keys(customer.prices).length > 0 ? "Precios de su lista" : "Precios del mostrador"}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Quitar el cliente"
                onClick={() => {
                  setCustomer(null);
                  setCustomerQuery("");
                }}
              >
                <X />
              </Button>
            </div>
          ) : (
            <>
              <Input
                id="pos-customer"
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                autoComplete="off"
                placeholder="Buscar cliente por nombre"
                className="h-11"
              />
              {customerResults.length > 0 ? (
                <ul aria-label="Clientes encontrados" className="divide-y rounded-lg border">
                  {customerResults.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="hover:bg-accent w-full px-3 py-2 text-left text-sm"
                        onClick={() => setCustomer(c)}
                      >
                        {c.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>

        {lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Tocá un producto o escaneá su código para agregarlo.
          </p>
        ) : (
          <ul className="grid gap-3" aria-label="Productos de la venta">
            {lines.map((p) => (
              <li key={p.productId} className="grid gap-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{p.name}</span>
                  <span className="tabular-nums">{formatARS(priceOf(p) * (cart[p.productId] ?? 0))}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11"
                    aria-label={`Quitar una unidad de ${p.name}`}
                    onClick={() => add(p, -1)}
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
                    disabled={room(p) <= 0}
                    onClick={() => add(p, 1)}
                  >
                    <Plus />
                  </Button>
                  <span className="text-muted-foreground text-xs">{formatARS(priceOf(p))} c/u</span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium" id="pos-method-label">
              Medio de pago
            </span>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={split}
                onChange={(e) => setSplit(e.target.checked)}
              />
              Dividir el pago
            </label>
          </div>
          {split ? (
            <div className="grid gap-2 rounded-lg border p-3">
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <NativeSelect
                  aria-label="Medio 1"
                  className="h-11"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as StoreMethod)}
                >
                  {STORE_METHOD_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </NativeSelect>
                <Input
                  aria-label="Monto medio 1"
                  inputMode="decimal"
                  placeholder="0,00"
                  className="h-11"
                  value={amount1}
                  onChange={(e) => setAmount1(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-[1fr_120px] items-center gap-2">
                <NativeSelect
                  aria-label="Medio 2"
                  className="h-11"
                  value={method2}
                  onChange={(e) => setMethod2(e.target.value as StoreMethod)}
                >
                  {STORE_METHOD_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </NativeSelect>
                <span className="text-right text-sm font-medium tabular-nums" data-testid="pos-remainder">
                  {remainder != null && remainder > 0 ? formatARS(remainder) : "—"}
                </span>
              </div>
              <p role="status" className="text-destructive min-h-4 text-xs">
                {lines.length > 0 ? (splitError ?? "") : ""}
              </p>
            </div>
          ) : (
            <div role="radiogroup" aria-labelledby="pos-method-label" className="grid grid-cols-2 gap-2">
              {STORE_METHOD_OPTIONS.map((m) => (
                <Button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={method === m.value}
                  title={"hint" in m ? m.hint : undefined}
                  variant={method === m.value ? "default" : "outline"}
                  className="h-12 text-base"
                  onClick={() => setMethod(m.value)}
                >
                  {m.label}
                </Button>
              ))}
            </div>
          )}
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
            onClick={reset}
          >
            <Trash2 />
          </Button>
          <Button type="button" className="h-14 flex-1 text-lg" disabled={!canCharge} onClick={charge}>
            Cobrar {total > 0 ? formatARS(total) : ""}
          </Button>
        </div>
      </section>
    </div>
  );
}
