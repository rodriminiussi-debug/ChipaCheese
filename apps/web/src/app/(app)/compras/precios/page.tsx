import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { DateText, Money, Num } from "@/components/app/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { priceOverview } from "@/features/purchases/service";
import { UNIT } from "@/lib/labels";

export const metadata = { title: "Precios de compra" };

export default async function PricesPage() {
  await requirePermission("purchases:read");
  const rows = await priceOverview(db);
  return (
    <>
      <PageHeader
        title="Precios de compra"
        description="Último precio neto (sin IVA) por insumo, con variación contra la compra anterior (RF-09)."
        actions={
          <Button asChild variant="outline">
            <a href="/compras/precios/exportar" download>
              <Download /> Exportar a Excel
            </a>
          </Button>
        }
      />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Insumo</TableHead>
              <TableHead className="text-right">Último precio neto</TableHead>
              <TableHead className="text-right">Variación</TableHead>
              <TableHead className="hidden md:table-cell">Proveedor</TableHead>
              <TableHead className="hidden md:table-cell">Fecha</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Proveedores</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.ingredientId}>
                <TableCell>
                  <Link href={`/compras/precios/${r.ingredientId}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.lastPrice} />{" "}
                  <span className="text-muted-foreground text-xs">/ {UNIT[r.unit]}</span>
                </TableCell>
                <TableCell className="text-right">
                  {r.variationPct != null ? (
                    <Num
                      value={r.variationPct}
                      suffix="%"
                      className={
                        r.variationPct > 0 ? "text-destructive" : r.variationPct < 0 ? "text-emerald-600" : ""
                      }
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">{r.supplierName ?? "—"}</TableCell>
                <TableCell className="hidden md:table-cell">
                  <DateText value={r.lastDate} />
                </TableCell>
                <TableCell className="hidden text-right tabular-nums lg:table-cell">
                  {r.suppliers || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
