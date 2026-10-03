"use client";

import { useMemo, useState } from "react";
import { marginPct, parseDecimalAR, pctChange, simulateUnitCost } from "@chipa/domain";
import { Money, Num } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { isCheese } from "../labels";
import { signedPct } from "../format";

export interface SimulatorData {
  starchKgPerRun: number;
  laborPerRun: number;
  producedKgPerRun: number;
  /** Insumos de la receta: cantidad por producción y último precio sin IVA (null = precio faltante). */
  ingredients: { ingredientId: string; name: string; dairy: boolean; qty: number; price: number | null }[];
  products: {
    id: string;
    name: string;
    netWeightKg: number;
    components: { ingredientId: string; name: string; qty: number; price: number | null }[];
  }[];
  priceLists: { id: string; name: string; targetMarginPct: number; prices: Record<string, number | null> }[];
}

function parsePct(raw: string | undefined): number {
  if (!raw) return 0;
  const n = parseDecimalAR(raw.replace("−", "-").replace("%", ""));
  return n == null || Number.isNaN(n) ? 0 : Math.max(-100, Math.min(1000, n));
}

const margin = (price: number | null | undefined, cost: number | null) =>
  price != null && price > 0 && cost != null ? marginPct(price, cost) : null;

/**
 * RF-39 · Simulador de sensibilidad: "si el precio de X cambia N %" → nuevo costo por bolsa y márgenes.
 * Usa la misma cuenta de la Regla 8 (`simulateUnitCost` del dominio) con los últimos precios de compra.
 */
export function SensitivitySimulator({ data }: { data: SimulatorData }) {
  const [raw, setRaw] = useState<Record<string, string>>({});
  const changes = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, v] of Object.entries(raw)) {
      const n = parsePct(v);
      if (n !== 0) out[id] = n;
    }
    return out;
  }, [raw]);
  const dirty = Object.keys(changes).length > 0;

  // Insumos que se pueden mover: los de la receta y los componentes de los productos (envase, jamón…).
  const movable = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const i of data.ingredients) m.set(i.ingredientId, { id: i.ingredientId, name: i.name });
    for (const p of data.products)
      for (const c of p.components) if (!m.has(c.ingredientId)) m.set(c.ingredientId, { id: c.ingredientId, name: c.name });
    return [...m.values()];
  }, [data]);

  const recipeComplete = data.ingredients.every((i) => i.price != null);
  const rows = useMemo(() => {
    if (!recipeComplete) return [];
    const recipeLines = data.ingredients.map((i) => ({
      ingredientId: i.ingredientId,
      qty: i.qty,
      unitPriceNet: i.price ?? 0,
    }));
    return data.products.map((p) => {
      const complete = p.components.every((c) => c.price != null);
      const input = {
        recipeLines,
        laborPerRun: data.laborPerRun,
        producedKgPerRun: data.producedKgPerRun,
        components: p.components.map((c) => ({ ingredientId: c.ingredientId, qty: c.qty, unitPriceNet: c.price ?? 0 })),
        netWeightKg: p.netWeightKg,
      };
      const before = simulateUnitCost({ ...input, changesPct: {} });
      const after = simulateUnitCost({ ...input, changesPct: changes });
      return { product: p, complete, before, after };
    });
  }, [data, changes, recipeComplete]);

  const headline = rows[0];
  const set = (id: string, value: string) => setRaw((r) => ({ ...r, [id]: value }));
  const applyTo = (ids: string[], pct: number) =>
    setRaw((r) => ({ ...r, ...Object.fromEntries(ids.map((id) => [id, String(pct).replace(".", ",")])) }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Simulador de sensibilidad</CardTitle>
        <CardDescription>
          Cambiá el precio de uno o más insumos y mirá cuánto cambian el costo por bolsa y los márgenes de cada
          lista. Sirve para negociar con proveedores: un 5 % menos en quesos baja cerca de un 2,7 % el costo de
          ingredientes.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              applyTo(
                data.ingredients.filter((i) => isCheese(i.name)).map((i) => i.ingredientId),
                -5,
              )
            }
          >
            Quesos −5 %
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              applyTo(
                data.ingredients.filter((i) => i.dairy).map((i) => i.ingredientId),
                -5,
              )
            }
          >
            Lácteos −5 %
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => applyTo(movable.map((m) => m.id), 10)}
          >
            Todo +10 %
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRaw({})} disabled={!dirty}>
            Limpiar
          </Button>
        </div>

        <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="sr-only">Variación de precio por insumo, en porcentaje</legend>
          {movable.map((m) => (
            <Field key={m.id}>
              <FieldLabel htmlFor={`sim-${m.id}`}>Cambio en {m.name} (%)</FieldLabel>
              <Input
                id={`sim-${m.id}`}
                inputMode="decimal"
                placeholder="0"
                value={raw[m.id] ?? ""}
                onChange={(e) => set(m.id, e.target.value)}
              />
            </Field>
          ))}
        </fieldset>

        {!recipeComplete ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Falta el precio de algún insumo de la receta: cargá la compra para poder simular.
          </p>
        ) : (
          <>
            {headline ? (
              <div
                className="grid grid-cols-2 gap-3 lg:grid-cols-4"
                aria-live="polite"
                data-testid="simulator-summary"
              >
                <Summary
                  label="Ingredientes por kg"
                  before={headline.before.ingredientsCostPerKg}
                  after={headline.after.ingredientsCostPerKg}
                  dirty={dirty}
                  testId="sim-ingredients"
                />
                <Summary
                  label="Costo directo por kg"
                  before={headline.before.costPerKg}
                  after={headline.after.costPerKg}
                  dirty={dirty}
                  testId="sim-cost-kg"
                />
                {rows
                  .filter((r) => r.complete && r.product.netWeightKg === 0.5)
                  .slice(0, 2)
                  .map((r) => (
                    <Summary
                      key={r.product.id}
                      label={`Costo por bolsa · ${r.product.name}`}
                      before={r.before.unitCost}
                      after={r.after.unitCost}
                      dirty={dirty}
                      testId={`sim-bag-${r.product.id}`}
                    />
                  ))}
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-lg border">
              <Table aria-label="Resultado de la simulación por producto">
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Costo actual</TableHead>
                    <TableHead className="text-right">Costo simulado</TableHead>
                    <TableHead className="text-right">Variación</TableHead>
                    {data.priceLists.map((l) => (
                      <TableHead key={l.id} className="text-right">
                        Margen · {l.name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.product.id}>
                      <TableCell className="font-medium">{r.product.name}</TableCell>
                      {r.complete ? (
                        <>
                          <TableCell className="text-right">
                            <Money value={r.before.unitCost} />
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            <Money value={r.after.unitCost} />
                          </TableCell>
                          <TableCell className="text-right">
                            {signedPct(pctChange(r.before.unitCost, r.after.unitCost), 2)}
                          </TableCell>
                          {data.priceLists.map((l) => {
                            const price = l.prices[r.product.id];
                            const mb = margin(price, r.before.unitCost);
                            const ma = margin(price, r.after.unitCost);
                            return (
                              <TableCell key={l.id} className="text-right tabular-nums">
                                {mb == null || ma == null ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <span className={cn(ma < l.targetMarginPct && "text-amber-700 dark:text-amber-400")}>
                                    <Num value={mb} decimals={1} suffix="%" /> →{" "}
                                    <Num value={ma} decimals={1} suffix="%" />
                                  </span>
                                )}
                              </TableCell>
                            );
                          })}
                        </>
                      ) : (
                        <TableCell colSpan={3 + data.priceLists.length}>
                          <StatusBadge tone="warn">Precio faltante</StatusBadge>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-muted-foreground text-xs">
              Los márgenes en ámbar quedan por debajo del margen objetivo de la lista. La mano de obra no cambia con
              los precios.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Summary({
  label,
  before,
  after,
  dirty,
  testId,
}: {
  label: string;
  before: number;
  after: number;
  dirty: boolean;
  testId: string;
}) {
  const delta = pctChange(before, after);
  return (
    <div className="rounded-lg border p-3" data-testid={testId}>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-lg font-semibold tabular-nums">
        <Money value={dirty ? after : before} />
      </div>
      <div className="text-muted-foreground text-xs tabular-nums">
        {dirty ? (
          <>
            antes <Money value={before} /> · <span data-testid={`${testId}-delta`}>{signedPct(delta, 2)}</span>
          </>
        ) : (
          "sin cambios"
        )}
      </div>
    </div>
  );
}
