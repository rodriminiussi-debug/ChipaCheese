"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { activateRecipeAction } from "../actions";

/** Activa una versión de la receta: la vigente pasa a archivada. */
export function ActivateRecipeButton({ id, version }: { id: string; version: number }) {
  const router = useRouter();
  const activate = useAction(activateRecipeAction, {
    success: (d) => `Versión ${d.version} activada`,
    onSuccess: () => router.refresh(),
  });
  return (
    <Button onClick={() => activate.run({ id })} disabled={activate.pending}>
      <CheckCircle2 /> Activar versión {version}
    </Button>
  );
}
