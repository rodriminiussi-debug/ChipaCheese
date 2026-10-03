import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { Kg } from "@/components/app/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { countOverdueOrders, packingSheet } from "@/features/orders/service";
import { OrderStatusBadge } from "@/features/orders/components/orders-table";
import { PrintButton } from "@/features/orders/components/print-button";
import { weekdayDate } from "@/features/orders/components/estimate-card";
import { todayAR } from "@/lib/dates";

export const metadata = { title: "Hoja de envasado" };

/**
 * Hoja de envasado del día: reemplaza la hoja manuscrita. Para una fecha comprometida, totales a
 * preparar por producto (unidades y kg) y por cliente.
 */
export default async function PackingSheetPage(props: PageProps<"/pedidos/envasado">) {
  await requirePermission("orders:read");
  const { fecha } = await props.searchParams;
  const today = todayAR();
  const date = typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : today;
  const [sheet, overdue] = await Promise.all([packingSheet(db, date), countOverdueOrders(db, today)]);

  return (
    <>
      <PageHeader
        title="Hoja de envasado"
        description={<span data-testid="sheet-date">{weekdayDate(date)}</span>}
        actions={
          <>
            <Button asChild variant="outline" size="icon" aria-label="Día anterior" className="print:hidden">
              <Link href={`/pedidos/envasado?fecha=${addDays(date, -1)}`}>
                <ChevronLeft />
              </Link>
            </Button>
            <form className="flex gap-2 print:hidden">
              <Input type="date" name="fecha" defaultValue={date} aria-label="Fecha" className="w-40" />
              <Button type="submit" variant="outline">
                Ver
              </Button>
            </form>
            <Button asChild variant="outline" size="icon" aria-label="Día siguiente" className="print:hidden">
              <Link href={`/pedidos/envasado?fecha=${addDays(date, 1)}`}>
                <ChevronRight />
              </Link>
            </Button>
            <PrintButton />
          </>
        }
      />

      {overdue > 0 ? (
        <p className="mb-4 text-sm print:hidden">
          Hay {overdue} {overdue === 1 ? "pedido atrasado" : "pedidos atrasados"} sin entregar.{" "}
          <Link href="/pedidos?atrasados=1" className="underline">
            Verlos
          </Link>
        </p>
      ) : null}

      {sheet.orderCount === 0 ? (
        <EmptyState
          title="No hay pedidos para preparar"
          description="Ningún pedido pendiente tiene esa fecha comprometida."
        />
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-3 gap-3">
            <StatCard title="Pedidos" value={sheet.orderCount} />
            <StatCard title="Unidades" value={sheet.totalUnits} />
            <StatCard title="Peso total" value={<Kg value={sheet.totalKg} />} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Total a preparar por producto</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Unidades</TableHead>
                    <TableHead className="text-right">Kg</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sheet.byProduct.map((p) => (
                    <TableRow key={p.productId}>
                      <TableCell>
                        {p.name}
                        {p.boardCode ? (
                          <span className="text-muted-foreground ml-2 text-xs">{p.boardCode}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{p.units}</TableCell>
                      <TableCell className="text-right">
                        <Kg value={p.kg} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Por cliente</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {sheet.byCustomer.map((c) => (
                <div key={c.customerId} className="break-inside-avoid rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{c.name}</p>
                    <Kg value={c.kg} className="text-muted-foreground text-sm" />
                  </div>
                  <div className="text-muted-foreground mb-1 flex flex-wrap gap-2 text-xs">
                    {c.orders.map((o) => (
                      <Link
                        key={o.id}
                        href={`/pedidos/${o.id}`}
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        #{o.number} <OrderStatusBadge status={o.status} />
                      </Link>
                    ))}
                  </div>
                  <ul className="text-sm">
                    {c.lines.map((l) => (
                      <li key={l.productId} className="flex justify-between gap-2">
                        <span>{l.name}</span>
                        <span className="font-semibold tabular-nums">{l.units}</span>
                      </li>
                    ))}
                  </ul>
                  {c.orders.some((o) => o.notes) ? (
                    <p className="text-muted-foreground mt-1 text-xs">
                      {c.orders.flatMap((o) => (o.notes ? [o.notes] : [])).join(" · ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
