"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setLotHoldAction } from "@/features/quality/actions";

/** Retiro: retiene de una vez todos los lotes terminados que usaron un lote de materia prima. */
export function HoldAllButton({ lotIds }: { lotIds: string[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  if (lotIds.length === 0) return null;
  return (
    <Button
      type="button"
      variant="destructive"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        let ok = 0;
        for (const finishedLotId of lotIds) {
          const res = await setLotHoldAction({ finishedLotId, onHold: true });
          if (res.ok) ok++;
          else toast.error(res.error);
        }
        setPending(false);
        if (ok) toast.success(`${ok} lote(s) retenido(s): no salen en despacho`);
        router.refresh();
      }}
    >
      <Lock /> Retener todos los lotes ({lotIds.length})
    </Button>
  );
}
