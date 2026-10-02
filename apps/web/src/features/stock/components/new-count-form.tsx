"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { createInventoryCountAction } from "../actions";

/** RF-15: crea un conteo (materia prima o producto terminado) precargado con el saldo del sistema. */
export function NewCountButtons() {
  const router = useRouter();
  const create = useAction(createInventoryCountAction, {
    success: (r) => `Inventario creado con ${r.items} posiciones`,
    onSuccess: (r) => router.push(`/stock/inventario/${r.id}` as Route),
  });
  return (
    <div className="flex flex-wrap gap-2">
      <Button disabled={create.pending} onClick={() => create.run({ itemKind: "ingredient" })}>
        <ClipboardList /> Nuevo conteo de materia prima
      </Button>
      <Button variant="outline" disabled={create.pending} onClick={() => create.run({ itemKind: "product" })}>
        <ClipboardList /> Nuevo conteo de producto terminado
      </Button>
    </div>
  );
}
