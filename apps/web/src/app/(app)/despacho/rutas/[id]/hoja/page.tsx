import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { formatKg } from "@chipa/domain";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { PrintButton } from "@/features/orders/components/print-button";
import { PrintStyles } from "@/features/dispatch/components/print-styles";
import { getRoute } from "@/features/dispatch/service";
import { ROUTE_STATUS, weekdayDate } from "@/features/dispatch/labels";

export const metadata = { title: "Hoja de ruta" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** RF-24: hoja de ruta imprimible (reemplaza el papel que arma el chofer). */
export default async function RouteSheetPage(props: PageProps<"/despacho/rutas/[id]/hoja">) {
  await requirePermission("dispatch:read");
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();
  const route = await getRoute(db, id);
  if (!route) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <PrintStyles />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost">
          <Link href={`/despacho/rutas/${route.id}`}>
            <ChevronLeft /> Volver a la ruta
          </Link>
        </Button>
        <PrintButton label="Imprimir hoja de ruta" />
      </div>

      <header className="mb-4 flex items-start justify-between gap-4 border-b pb-3">
        <div>
          <p className="text-lg font-bold">Chipa Cheese — Pacon SRL</p>
          <h1 className="text-2xl font-semibold">Hoja de ruta</h1>
        </div>
        <dl className="text-right text-sm">
          <div>
            <dt className="text-muted-foreground inline">Fecha: </dt>
            <dd className="inline font-medium">{weekdayDate(route.date)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground inline">Estado: </dt>
            <dd className="inline">{ROUTE_STATUS[route.status]?.label}</dd>
          </div>
        </dl>
      </header>

      <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Chofer</dt>
          <dd className="font-medium">{route.driver?.name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Vehículo</dt>
          <dd className="font-medium">
            {route.vehicle ? `${route.vehicle.name} (${route.vehicle.plate})` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Peso total</dt>
          <dd className="font-medium">{formatKg(route.totals.kg)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Bultos</dt>
          <dd className="font-medium">{route.totals.units}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Km inicial</dt>
          <dd className="font-medium">{route.kmStart ?? "______"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Km final</dt>
          <dd className="font-medium">{route.kmEnd ?? "______"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Temperatura equipo de frío</dt>
          <dd className="font-medium">
            {route.coldUnitTempC != null ? `${route.coldUnitTempC} °C` : "______"}
          </dd>
        </div>
      </dl>
      {route.notes ? <p className="mb-4 text-sm">Observaciones: {route.notes}</p> : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Destino</TableHead>
            <TableHead>Pedido y productos</TableHead>
            <TableHead className="text-right">Kg</TableHead>
            <TableHead className="text-right">Bultos</TableHead>
            <TableHead className="w-24">Hecho</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {route.stops.map((s) => (
            <TableRow key={s.id} className="break-inside-avoid align-top">
              <TableCell className="font-semibold">{s.seq}</TableCell>
              <TableCell className="whitespace-normal">
                <p className="font-medium">{s.title}</p>
                <p className="text-muted-foreground text-xs">
                  {s.kind === "delivery"
                    ? [s.address ?? "Sin dirección", s.zoneName].filter(Boolean).join(" · ")
                    : "Retiro en proveedor"}
                </p>
              </TableCell>
              <TableCell className="whitespace-normal">
                {s.kind === "delivery" ? (
                  <>
                    <p className="text-xs">Pedido #{s.orderNumber}</p>
                    <ul className="text-xs">
                      {s.lines.map((l) => (
                        <li key={l.productName}>
                          {l.qtyUnits} × {l.productName}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {s.notes ? <p className="text-xs italic">{s.notes}</p> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {s.kind === "delivery" ? formatKg(s.kg) : ""}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {s.kind === "delivery" ? s.units : ""}
              </TableCell>
              <TableCell>
                {s.done ? "Sí" : <span className="inline-block h-5 w-5 rounded border" />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-muted-foreground mt-6 text-xs">
        Firma del chofer: ________________________ &nbsp; Hora de salida: ______ &nbsp; Hora de regreso:
        ______
      </p>
    </div>
  );
}
