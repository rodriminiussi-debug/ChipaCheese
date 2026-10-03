import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { formatDateAR } from "@chipa/domain";
import { Money, Num } from "@/components/app/format";
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
import { UNIT } from "@/lib/labels";
import { PrintButton } from "@/features/orders/components/print-button";
import { PrintStyles } from "@/features/dispatch/components/print-styles";
import { getOrder } from "@/features/purchases/service";
import { PO_STATUS } from "@/features/purchases/labels";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const metadata = { title: "Orden de compra" };

/** `20123456786` → `20-12345678-6`. */
function formatCuit(cuit: string | null) {
  if (!cuit) return "—";
  const d = cuit.replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : cuit;
}

/**
 * Orden de compra imprimible (RF-10): para mandar o dejar en el proveedor. Se imprime con el diálogo del
 * navegador (también permite "Guardar como PDF"); el menú y los botones no salen en el papel.
 */
export default async function PrintOrderPage(props: PageProps<"/compras/ordenes/[id]/imprimir">) {
  await requirePermission("purchases:read");
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();
  const order = await getOrder(db, id);
  if (!order) notFound();
  const estimated = order.items.reduce((a, i) => a + i.qty * (i.estimatedUnitPrice ?? 0), 0);
  const status = PO_STATUS[order.status]!;

  return (
    <div className="mx-auto max-w-3xl">
      <PrintStyles />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost">
          <Link href={`/compras/ordenes/${order.id}`}>
            <ChevronLeft /> Volver a la orden
          </Link>
        </Button>
        <PrintButton label="Imprimir / guardar PDF" />
      </div>

      <article className="rounded-lg border p-6 print:border-0 print:p-0" data-testid="orden-compra">
        <header className="flex items-start justify-between gap-4 border-b pb-4">
          <div>
            <p className="text-lg font-bold">Chipa Cheese</p>
            <p className="text-muted-foreground text-sm">Pacon SRL — chipá crudo congelado</p>
          </div>
          <div className="text-right">
            <h1 className="text-2xl font-semibold" data-testid="orden-numero">
              Orden de compra {order.number}
            </h1>
            <p className="text-sm">Fecha: {formatDateAR(order.orderedAt)}</p>
            {order.status !== "draft" && order.status !== "sent" ? (
              <p className="text-muted-foreground text-sm">Estado: {status.label}</p>
            ) : null}
          </div>
        </header>

        {order.pickup ? (
          <p
            className="mt-4 rounded-md border-2 border-black px-3 py-2 text-center text-sm font-bold uppercase"
            data-testid="orden-retiro"
          >
            Retiro en proveedor: pasamos a buscar la mercadería
          </p>
        ) : null}

        <dl className="grid gap-x-6 gap-y-2 py-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Proveedor</dt>
            <dd className="font-medium">{order.supplier.legalName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">CUIT</dt>
            <dd className="font-medium">{formatCuit(order.supplier.cuit)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Entrega esperada</dt>
            <dd className="font-medium">{order.expectedAt ? formatDateAR(order.expectedAt) : "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Responsable</dt>
            <dd className="font-medium">{order.responsible?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Contacto</dt>
            <dd className="font-medium">{order.supplier.whatsapp ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Entrega</dt>
            <dd className="font-medium">{order.pickup ? "Retiramos nosotros" : "Entrega el proveedor"}</dd>
          </div>
        </dl>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Insumo</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">Precio est. (neto)</TableHead>
              <TableHead className="text-right">Importe est.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.ingredient.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  <Num value={i.qty} decimals={Number.isInteger(i.qty) ? 0 : 3} suffix={UNIT[i.unit]} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Money value={i.estimatedUnitPrice} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {i.estimatedUnitPrice == null ? "—" : <Money value={i.qty * i.estimatedUnitPrice} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-semibold">
                Total estimado (sin IVA)
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                <Money value={estimated} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
        {order.notes ? <p className="mt-3 text-sm">Notas: {order.notes}</p> : null}
        <p className="text-muted-foreground mt-2 text-xs">
          Los precios son estimados (último precio de compra) y no incluyen IVA. Por favor confirmar la
          recepción de esta orden.
        </p>

        <footer className="mt-10 grid gap-8 sm:grid-cols-2">
          <div>
            <div className="h-16 border-b" />
            <p className="mt-1 text-sm">Chipa Cheese — {order.responsible?.name ?? "responsable"}</p>
          </div>
          <div>
            <div className="h-16 border-b" />
            <p className="mt-1 text-sm">Proveedor — firma y aclaración</p>
          </div>
        </footer>
      </article>
    </div>
  );
}
