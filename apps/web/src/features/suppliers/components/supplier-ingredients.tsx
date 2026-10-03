"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { Money, DateText, Num } from "@/components/app/format";
import { unitLabel } from "@/components/app/format";
import { setSupplierIngredientsAction } from "../actions";
import type { SupplierIngredientRow } from "../service";

/** Insumos que vende el proveedor, con su código y el último precio neto que cobró (RF-07). */
export function SupplierIngredients({
  supplierId,
  rows,
  editable,
}: {
  supplierId: string;
  rows: SupplierIngredientRow[];
  editable: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(() =>
    Object.fromEntries(rows.map((r) => [r.ingredientId, { sold: r.sold, code: r.supplierCode ?? "" }])),
  );
  const save = useAction(setSupplierIngredientsAction, {
    success: "Insumos guardados",
    onSuccess: () => router.refresh(),
  });

  const visible = editable ? rows : rows.filter((r) => r.sold);
  if (!visible.length) return <p className="text-muted-foreground text-sm">Todavía no tiene insumos asignados.</p>;

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border">
        <div>
          {visible.map((r) => {
            const s = state[r.ingredientId]!;
            return (
              <div key={r.ingredientId} className="flex items-center gap-3 border-b p-3 last:border-0">
                {editable ? (
                  <Checkbox
                    aria-label={`Vende ${r.name}`}
                    checked={s.sold}
                    onCheckedChange={(v) =>
                      setState((p) => ({ ...p, [r.ingredientId]: { ...s, sold: v === true } }))
                    }
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-muted-foreground text-xs">por {unitLabel(r.unit)}</div>
                </div>
                {editable ? (
                  <Input
                    className="hidden w-32 sm:block"
                    aria-label={`Código del proveedor para ${r.name}`}
                    placeholder="Código"
                    value={s.code}
                    disabled={!s.sold}
                    onChange={(e) => setState((p) => ({ ...p, [r.ingredientId]: { ...s, code: e.target.value } }))}
                  />
                ) : null}
                <div className="text-right text-sm">
                  {r.lastPrice != null ? (
                    <>
                      <Money value={r.lastPrice} />
                      <div className="text-muted-foreground text-xs">
                        <DateText value={r.lastPriceDate} />
                      </div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Sin compras</span>
                  )}
                </div>
                <div className="w-16 text-right text-xs">
                  {r.variationPct != null ? (
                    <Num
                      value={r.variationPct}
                      suffix="%"
                      className={r.variationPct > 0 ? "text-destructive" : "text-emerald-600"}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {editable ? (
        <div>
          <Button
            disabled={save.pending}
            onClick={() =>
              save.run({
                supplierId,
                items: Object.entries(state)
                  .filter(([, v]) => v.sold)
                  .map(([ingredientId, v]) => ({ ingredientId, supplierCode: v.code })),
              })
            }
          >
            Guardar insumos
          </Button>
        </div>
      ) : null}
    </div>
  );
}
