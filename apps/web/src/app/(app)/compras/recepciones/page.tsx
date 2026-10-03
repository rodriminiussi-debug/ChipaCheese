import Link from "next/link";
import { PackagePlus } from "lucide-react";
import { MAX_REFRIGERATED_TEMP_C, isTemperatureAlert } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText, Num } from "@/components/app/format";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listReceptions } from "@/features/purchases/service";
import { can } from "@/lib/rbac";
import { toIsoDateAR } from "@/lib/dates";

export const metadata = { title: "Recepciones" };

export default async function ReceptionsPage() {
  const user = await requirePermission("purchases:read");
  const receptions = await listReceptions(db);
  return (
    <>
      <PageHeader
        title="Recepciones"
        description="Mercadería recibida con lote del proveedor, vencimiento y temperatura (RF-11)."
        actions={
          can(user.role, "purchases:write") ? (
            <Button asChild>
              <Link href="/compras/recepciones/nueva">
                <PackagePlus /> Recibir mercadería
              </Link>
            </Button>
          ) : null
        }
      />
      {receptions.length === 0 ? (
        <EmptyState title="Todavía no hay recepciones" />
      ) : (
        <div className="grid gap-4">
          {receptions.map((r) => (
            <section key={r.id} className="rounded-lg border">
              <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b p-3 text-sm">
                <DateText value={toIsoDateAR(r.receivedAt)} />
                <span className="font-medium">{r.supplier.legalName}</span>
                {r.purchaseOrder ? (
                  <Link
                    href={`/compras/ordenes/${r.purchaseOrder.id}`}
                    className="text-muted-foreground hover:underline"
                  >
                    {r.purchaseOrder.number}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Entrega libre</span>
                )}
                {r.deliveryNote ? (
                  <span className="text-muted-foreground">Remito {r.deliveryNote}</span>
                ) : null}
                <span className="text-muted-foreground ml-auto">{r.receivedBy?.name}</span>
              </header>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Insumo</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead>Lote</TableHead>
                    <TableHead className="hidden sm:table-cell">Vence</TableHead>
                    <TableHead>Temp.</TableHead>
                    <TableHead className="hidden md:table-cell">Ubicación</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.lots.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>{l.ingredient.name}</TableCell>
                      <TableCell className="text-right">
                        <Num value={l.receivedQty} decimals={Number.isInteger(l.receivedQty) ? 0 : 3} />
                      </TableCell>
                      <TableCell>{l.supplierLotCode ?? "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <DateText value={l.expiryDate} />
                      </TableCell>
                      <TableCell>
                        {l.temperatureC == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : isTemperatureAlert(l.temperatureC) ? (
                          <StatusBadge tone="bad">
                            {String(l.temperatureC).replace(".", ",")} °C &gt; {MAX_REFRIGERATED_TEMP_C}
                          </StatusBadge>
                        ) : (
                          <span className="tabular-nums">{String(l.temperatureC).replace(".", ",")} °C</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{l.location?.name ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
