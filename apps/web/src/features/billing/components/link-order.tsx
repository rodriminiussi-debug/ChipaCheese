"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/app/native-select";
import { useAction } from "@/hooks/use-action";
import { formatARS } from "@chipa/domain";
import { linkInvoiceAction } from "../actions";

/** Vincular una factura sin pedido (p. ej. importada de ARCA) a un pedido entregado del cliente. */
export function LinkOrder({
  invoiceId,
  orders,
}: {
  invoiceId: string;
  orders: { id: string; number: number; total: number }[];
}) {
  const [orderId, setOrderId] = useState("");
  const link = useAction(linkInvoiceAction, { success: (r) => `Vinculada al pedido #${r.orderNumber}` });
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <NativeSelect
        aria-label="Pedido a vincular"
        value={orderId}
        onChange={(e) => setOrderId(e.target.value)}
        className="h-8 max-w-56 text-xs"
      >
        <option value="">Vincular a un pedido…</option>
        {orders.map((o) => (
          <option key={o.id} value={o.id}>
            #{o.number} · {formatARS(o.total)}
          </option>
        ))}
      </NativeSelect>
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        disabled={!orderId || link.pending}
        onClick={() => link.run({ invoiceId, orderId })}
      >
        <Link2 /> Vincular
      </Button>
    </div>
  );
}
