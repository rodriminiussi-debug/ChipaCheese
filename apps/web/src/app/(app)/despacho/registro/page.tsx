import Link from "next/link";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText } from "@/components/app/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { DispatchTabs } from "@/features/dispatch/components/dispatch-tabs";
import { listDispatchRegistry, registryProducts } from "@/features/dispatch/service";
import { registryFiltersFromParams } from "@/features/dispatch/schemas";
import { formatDispatchNumber } from "@/features/dispatch/labels";

export const metadata = { title: "Despacho · Registro BPM" };

/**
 * RF-28: registro de despacho BPM (planilla BPM-DESP) generado solo desde los remitos:
 * producto, lote, fecha de despacho, cantidad, destino, transporte/patente y responsable.
 */
export default async function DispatchRegistryPage(props: PageProps<"/despacho/registro">) {
  await requirePermission("dispatch:read");
  const filters = registryFiltersFromParams(await props.searchParams);
  const [rows, products] = await Promise.all([listDispatchRegistry(db, filters), registryProducts(db)]);
  const query = new URLSearchParams({ desde: filters.from, hasta: filters.to });
  if (filters.productId) query.set("producto", filters.productId);

  return (
    <>
      <PageHeader
        title="Despacho y reparto"
        description="Hojas de ruta, remitos con lote, salida del vehículo y costo del reparto (RF-24 a RF-28)."
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/api/despacho/registro?${query}&formato=pdf`} target="_blank" rel="noreferrer">
                <Download /> Exportar PDF
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={`/api/despacho/registro?${query}&formato=xlsx`} download>
                <Download /> Exportar Excel
              </a>
            </Button>
          </>
        }
      />
      <DispatchTabs />

      <form className="mb-4 flex flex-wrap items-end gap-3" aria-label="Filtros del registro">
        <div className="grid gap-1.5">
          <Label htmlFor="reg-desde">Desde</Label>
          <Input id="reg-desde" type="date" name="desde" defaultValue={filters.from} className="w-40" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="reg-hasta">Hasta</Label>
          <Input id="reg-hasta" type="date" name="hasta" defaultValue={filters.to} className="w-40" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="reg-producto">Producto</Label>
          <select
            id="reg-producto"
            name="producto"
            defaultValue={filters.productId ?? ""}
            className="border-input bg-background h-9 w-64 rounded-md border px-2 text-sm"
          >
            <option value="">Todos</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title="No hay despachos en el período"
          description="El registro se completa solo cada vez que se genera un remito."
        />
      ) : (
        <div className="rounded-lg border">
          <Table data-testid="registry-table">
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Lote</TableHead>
                <TableHead>Fecha de despacho</TableHead>
                <TableHead className="text-right">Cantidad (u.)</TableHead>
                <TableHead>Destino</TableHead>
                <TableHead>Transporte / patente</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead>Remito</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.productName}</TableCell>
                  <TableCell className="font-medium tabular-nums">{r.lotCode}</TableCell>
                  <TableCell>
                    <DateText value={r.date} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.qtyUnits}</TableCell>
                  <TableCell>{r.destination}</TableCell>
                  <TableCell>{r.transport}</TableCell>
                  <TableCell>{r.responsible ?? "—"}</TableCell>
                  <TableCell>
                    <Link href={`/despacho/remitos/${r.dispatchId}`} className="hover:underline">
                      {formatDispatchNumber(r.dispatchNumber)}
                    </Link>
                    {r.status === "rejected" ? (
                      <StatusBadge tone="bad" className="ml-1">
                        Rechazado
                      </StatusBadge>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
