"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { createInventoryCountAction } from "../actions";

/** Modo planta: abrir un conteo nuevo (materia prima o producto terminado), precargado con el saldo del sistema. */
export function PlantNewCount({ kinds }: { kinds: ("ingredient" | "product")[] }) {
  const router = useRouter();
  const create = useAction(createInventoryCountAction, {
    onSuccess: (r) => router.push(`/planta/inventario?id=${r.id}` as Route),
  });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {kinds.includes("ingredient") ? (
        <Button
          size="lg"
          className="h-20 text-xl"
          disabled={create.pending}
          onClick={() => create.run({ itemKind: "ingredient" })}
        >
          <ClipboardList className="size-7" /> Contar materia prima
        </Button>
      ) : null}
      {kinds.includes("product") ? (
        <Button
          size="lg"
          variant="outline"
          className="h-20 text-xl"
          disabled={create.pending}
          onClick={() => create.run({ itemKind: "product" })}
        >
          <ClipboardList className="size-7" /> Contar producto terminado
        </Button>
      ) : null}
    </div>
  );
}
