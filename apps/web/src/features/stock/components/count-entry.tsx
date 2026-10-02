"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Save } from "lucide-react";
import { countDifference, formatDateAR, formatNumber } from "@chipa/domain";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { UNIT } from "@/lib/labels";
import { confirmInventoryCountAction, saveInventoryCountAction, voidInventoryCountAction } from "../actions";
import type { CountItemRow } from "../inventory";

/**
 * RF-15: pantalla de carga del conteo, pensada para tablet: inputs grandes, agrupada por ubicación,
 * se puede guardar parcial y confirmar al final (las posiciones sin contar no se ajustan).
 */
export function CountEntry({ countId, items }: { countId: string; items: CountItemRow[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((i) => [i.id, i.countedQty == null ? "" : String(i.countedQty)])),
  );
  const payload = () => ({
    countId,
    items: items.map((i) => {
      const v = values[i.id]?.trim() ?? "";
      return { id: i.id, countedQty: v === "" ? null : Number(v) };
    }),
  });

  const save = useAction(saveInventoryCountAction, { success: "Avance guardado" });
  const confirm = useAction(confirmInventoryCountAction, {
    success: (r) =>
      r.adjusted
        ? `Inventario confirmado: ${r.adjusted} ajuste${r.adjusted === 1 ? "" : "s"} registrado${r.adjusted === 1 ? "" : "s"}`
        : "Inventario confirmado sin diferencias",
    onSuccess: () => router.refresh(),
  });
  const voidCount = useAction(voidInventoryCountAction, {
    success: "Inventario anulado",
    onSuccess: () => router.refresh(),
  });

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; rows: CountItemRow[] }>();
    for (const i of items) {
      const g = m.get(i.locationId) ?? { name: `${i.locationCode} · ${i.locationName}`, rows: [] };
      g.rows.push(i);
      m.set(i.locationId, g);
    }
    return [...m.values()];
  }, [items]);

  const filled = items.filter((i) => (values[i.id]?.trim() ?? "") !== "").length;
  const pending = save.pending || confirm.pending || voidCount.pending;

  return (
    <div className="grid gap-6">
      <div className="bg-background sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b py-3">
        <p className="text-sm" aria-live="polite">
          Contadas: <strong>{filled}</strong> de {items.length}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="lg" variant="outline" disabled={pending} onClick={() => save.run(payload())}>
            <Save /> Guardar avance
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="lg" disabled={pending || filled === 0}>
                <CheckCheck /> Confirmar inventario
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Confirmar el inventario?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se registrará un ajuste por cada diferencia entre lo contado y el sistema.
                  {items.length - filled > 0
                    ? ` Las ${items.length - filled} posiciones sin contar no se modifican.`
                    : ""}{" "}
                  Esta acción no se puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Seguir contando</AlertDialogCancel>
                <AlertDialogAction onClick={() => confirm.run(payload())}>Sí, confirmar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button size="lg" variant="ghost" disabled={pending} onClick={() => voidCount.run({ countId })}>
            Anular
          </Button>
        </div>
      </div>

      {groups.map((g) => (
        <section key={g.name} className="grid gap-3">
          <h2 className="text-lg font-semibold">{g.name}</h2>
          <ul className="grid gap-3">
            {g.rows.map((i) => {
              const raw = values[i.id]?.trim() ?? "";
              const diff = raw === "" ? null : countDifference(i.systemQty, Number(raw));
              const label = `${i.itemName}${i.lotCode ? ` · lote ${i.lotCode}` : ""} · ${i.locationCode}`;
              return (
                <li
                  key={i.id}
                  className="grid items-center gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_auto_12rem]"
                >
                  <div>
                    <p className="text-base font-medium">{i.itemName}</p>
                    <p className="text-muted-foreground text-sm">
                      {i.lotCode ? `Lote ${i.lotCode}` : "Sin lote"}
                      {i.expiryDate ? ` · vence ${formatDateAR(i.expiryDate)}` : ""}
                    </p>
                  </div>
                  <p className="text-sm sm:text-right">
                    Sistema:{" "}
                    <strong className="tabular-nums">
                      {formatNumber(i.systemQty, i.unit === "unit" ? 0 : 2)} {UNIT[i.unit]}
                    </strong>
                    {diff != null && diff !== 0 ? (
                      <span
                        className={`ml-2 font-medium ${diff < 0 ? "text-destructive" : "text-emerald-700"}`}
                      >
                        ({diff > 0 ? "+" : ""}
                        {formatNumber(diff, 2)})
                      </span>
                    ) : null}
                  </p>
                  <Input
                    aria-label={label}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min={0}
                    placeholder="Contado"
                    value={values[i.id] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [i.id]: e.target.value }))}
                    className="h-14 text-right text-xl tabular-nums md:text-xl"
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">No hay posiciones con stock para contar.</p>
      ) : null}
    </div>
  );
}
