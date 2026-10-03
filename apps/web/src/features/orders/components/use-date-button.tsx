"use client";

import { useRouter } from "next/navigation";
import { CalendarCheck } from "lucide-react";
import { formatDateAR } from "@chipa/domain";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { setPromisedDateAction } from "../actions";

/** RF-05: "Usar esta fecha": pone la fecha posible como fecha comprometida del pedido ya guardado. */
export function UseDateButton({ orderId, date }: { orderId: string; date: string }) {
  const router = useRouter();
  const set = useAction(setPromisedDateAction, {
    success: (r) => `Fecha comprometida: ${formatDateAR(r.promisedDate)}`,
    onSuccess: () => router.refresh(),
  });
  return (
    <Button type="button" size="sm" disabled={set.pending} onClick={() => set.run({ id: orderId, date })}>
      <CalendarCheck /> Usar esta fecha
    </Button>
  );
}
