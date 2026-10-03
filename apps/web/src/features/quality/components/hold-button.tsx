"use client";

import { useRouter } from "next/navigation";
import { Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { setLotHoldAction } from "../actions";

/** Retener / liberar un lote terminado: un lote retenido no sale en despacho. */
export function HoldButton({
  finishedLotId,
  onHold,
  size = "sm",
}: {
  finishedLotId: string;
  onHold: boolean;
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const hold = useAction(setLotHoldAction, {
    success: (r) => (r.onHold ? "Lote retenido: no sale en despacho" : "Lote liberado"),
    onSuccess: () => router.refresh(),
  });
  return (
    <Button
      type="button"
      size={size}
      variant={onHold ? "outline" : "destructive"}
      disabled={hold.pending}
      onClick={() => hold.run({ finishedLotId, onHold: !onHold })}
    >
      {onHold ? <LockOpen /> : <Lock />}
      {onHold ? "Liberar lote" : "Retener lote"}
    </Button>
  );
}
