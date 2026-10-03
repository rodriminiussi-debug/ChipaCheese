"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { setComplaintStatusAction } from "../actions";

export function ComplaintStatusButton({ id, status }: { id: string; status: "open" | "closed" }) {
  const router = useRouter();
  const set = useAction(setComplaintStatusAction, {
    success: (r) => (r.status === "closed" ? "Reclamo cerrado" : "Reclamo reabierto"),
    onSuccess: () => router.refresh(),
  });
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={set.pending}
      onClick={() => set.run({ id, status: status === "open" ? "closed" : "open" })}
    >
      {status === "open" ? "Cerrar" : "Reabrir"}
    </Button>
  );
}
