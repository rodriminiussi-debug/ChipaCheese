import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { formatDateAR, formatKg } from "@chipa/domain";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { formatDateTimeAR } from "@/lib/dates";
import { PrintButton } from "@/features/orders/components/print-button";
import { PrintStyles } from "@/features/dispatch/components/print-styles";
import { getDispatch } from "@/features/dispatch/service";
import { DISPATCH_STATUS, formatDispatchNumber, proofUrl } from "@/features/dispatch/labels";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function generateMetadata(props: PageProps<"/despacho/remitos/[id]">) {
  const { id } = await props.params;
  const d = UUID.test(id) ? await getDispatch(db, id) : null;
  return { title: d ? `Remito ${formatDispatchNumber(d.number)}` : "Remito" };
}

/** `20123456786` → `20-12345678-6`. */
function formatCuit(cuit: string | null) {
  if (!cuit) return "—";
  const d = cuit.replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : cuit;
}

/** RF-25: remito imprimible con los lotes y vencimientos asignados por FEFO y espacio para la firma. */
export default async function DispatchNotePage(props: PageProps<"/despacho/remitos/[id]">) {
  await requirePermission("dispatch:read");
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();
  const d = await getDispatch(db, id);
  if (!d) notFound();
  const st = DISPATCH_STATUS[d.status];

  return (
    <div className="mx-auto max-w-3xl">
      <PrintStyles />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost">
          <Link href={d.routeId ? `/despacho/rutas/${d.routeId}` : "/despacho"}>
            <ChevronLeft /> Volver
          </Link>
        </Button>
        <PrintButton label="Imprimir remito" />
      </div>

      <article className="rounded-lg border p-6 print:border-0 print:p-0" data-testid="remito">
        <header className="flex items-start justify-between gap-4 border-b pb-4">
          <div>
            <p className="text-lg font-bold">Chipa Cheese</p>
            <p className="text-muted-foreground text-sm">Pacon SRL — chipá crudo congelado</p>
          </div>
          <div className="text-right">
            <h1 className="text-2xl font-semibold" data-testid="remito-number">
              Remito {formatDispatchNumber(d.number)}
            </h1>
            <p className="text-sm">Fecha: {formatDateTimeAR(d.dispatchedAt)}</p>
            <StatusBadge tone={st?.tone} className="mt-1 print:hidden">
              {st?.label}
            </StatusBadge>
          </div>
        </header>

        <dl className="grid gap-x-6 gap-y-2 py-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Cliente</dt>
            <dd className="font-medium">{d.customer.legalName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">CUIT</dt>
            <dd className="font-medium">{formatCuit(d.customer.cuit)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Dirección de entrega</dt>
            <dd className="font-medium">
              {[d.customer.address, d.customer.zone?.name].filter(Boolean).join(" · ") || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Pedido</dt>
            <dd className="font-medium">#{d.order.number}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Transporte</dt>
            <dd className="font-medium">
              {d.route?.vehicle ? `${d.route.vehicle.name} (${d.route.vehicle.plate})` : "—"}
              {d.route?.driver ? ` · ${d.route.driver.name}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Responsable del despacho</dt>
            <dd className="font-medium">{d.responsible?.name ?? "—"}</dd>
          </div>
        </dl>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead>Lote</TableHead>
              <TableHead>Vencimiento</TableHead>
              <TableHead className="text-right">Cantidad (u.)</TableHead>
              <TableHead className="text-right">Kg</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.productName}</TableCell>
                <TableCell className="font-medium tabular-nums">{i.lotCode}</TableCell>
                <TableCell className="tabular-nums">{formatDateAR(i.expiryDate)}</TableCell>
                <TableCell className="text-right tabular-nums">{i.qtyUnits}</TableCell>
                <TableCell className="text-right tabular-nums">{formatKg(i.kg)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-semibold">
                Total
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{d.totalUnits}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatKg(d.totalKg)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
        <p className="text-muted-foreground mt-2 text-xs">
          Producto congelado: mantener a −18 °C o menos. Lotes asignados por vencimiento más próximo (vence
          primero, sale primero).
        </p>

        <footer className="mt-10 grid gap-8 sm:grid-cols-2">
          <div>
            <div className="h-16 border-b">
              {d.status === "delivered" && d.proofFileKey ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={proofUrl(d.proofFileKey)}
                  alt="Conformidad del cliente"
                  className="h-16 object-contain"
                />
              ) : null}
            </div>
            <p className="mt-1 text-sm">Firma de conformidad</p>
          </div>
          <div>
            <div className="h-16 border-b pt-8 text-sm">
              {d.status === "delivered"
                ? d.receivedByName
                : d.status === "rejected"
                  ? `Rechazado: ${d.notes}`
                  : ""}
            </div>
            <p className="mt-1 text-sm">
              Aclaración
              {d.deliveredAt ? ` — entregado el ${formatDateTimeAR(d.deliveredAt)}` : ""}
            </p>
          </div>
        </footer>
      </article>
    </div>
  );
}
