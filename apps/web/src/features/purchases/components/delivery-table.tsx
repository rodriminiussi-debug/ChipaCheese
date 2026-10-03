import Link from "next/link";
import type { DeliveryTiming } from "@chipa/domain";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText } from "@/components/app/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PO_STATUS } from "../labels";

export interface DeliveryRow {
  order: {
    id: string;
    number: string;
    expectedAt: string | null;
    status: string;
    supplier: { legalName: string };
  };
  timing: DeliveryTiming;
}

const plural = (n: number) => `${n} ${n === 1 ? "día" : "días"}`;

/** Entregas esperadas de proveedores (OC enviadas), con atraso o días que faltan (RF-10). */
export function DeliveryTable({
  rows,
  title,
  tone,
}: {
  rows: DeliveryRow[];
  title: string;
  tone: "bad" | "info";
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold">
        {title} <StatusBadge tone={tone}>{rows.length}</StatusBadge>
      </h2>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nada por acá.</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Orden</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Esperada</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ order, timing }) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link href={`/compras/ordenes/${order.id}`} className="font-medium hover:underline">
                      {order.number}
                    </Link>
                  </TableCell>
                  <TableCell>{order.supplier.legalName}</TableCell>
                  <TableCell>
                    <DateText value={order.expectedAt} />{" "}
                    <span
                      className={
                        timing.state === "overdue"
                          ? "text-destructive text-xs"
                          : "text-muted-foreground text-xs"
                      }
                    >
                      {timing.state === "overdue"
                        ? `${plural(timing.days)} de atraso`
                        : timing.state === "today"
                          ? "hoy"
                          : timing.state === "upcoming"
                            ? `en ${plural(timing.days)}`
                            : "sin fecha"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={PO_STATUS[order.status]!.tone}>
                      {PO_STATUS[order.status]!.label}
                    </StatusBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
