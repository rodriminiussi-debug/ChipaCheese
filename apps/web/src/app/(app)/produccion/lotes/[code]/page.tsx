import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer, ScanSearch } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DateText, Kg } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { fmtQty } from "@/features/production/format";
import { getLotByCode } from "@/features/production/service";

export const metadata = { title: "Lote terminado" };

export default async function LotPage(props: PageProps<"/produccion/lotes/[code]">) {
  await requirePermission("production:read");
  const { code } = await props.params;
  const lot = await getLotByCode(db, decodeURIComponent(code));
  if (!lot) notFound();

  const totalStock = lot.stock.reduce((a, s) => a + s.qty, 0);
  const products = [...new Map(lot.packings.map((p) => [p.productId, p.product])).values()];

  return (
    <>
      <PageHeader
        title={`Lote ${lot.code}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            Elaborado el <DateText value={lot.productionDate} /> · vence el{" "}
            <DateText value={lot.expiryDate} />
            {lot.onHold ? <StatusBadge tone="bad">Retenido por calidad</StatusBadge> : null}
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/produccion/${lot.runId}`}>Ver producción</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/calidad/trazabilidad?lote=${encodeURIComponent(lot.code)}`}>
                <ScanSearch /> Trazabilidad
              </Link>
            </Button>
          </>
        }
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Stock actual del lote</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {lot.stock.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                El lote no tiene stock (se despachó todo o todavía no se envasó).
              </p>
            ) : (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead>Ubicación</TableHead>
                      <TableHead className="text-right">Unidades</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lot.stock.map((s) => (
                      <TableRow key={`${s.productId}-${s.locationId}`}>
                        <TableCell className="font-medium">{s.productName}</TableCell>
                        <TableCell>{s.locationCode}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtQty(s.qty)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="text-sm">
              Total en stock: <span className="font-medium tabular-nums">{fmtQty(totalStock)} unidades</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Envasado</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Bolsas</TableHead>
                    <TableHead className="text-right">Kg</TableHead>
                    <TableHead>Ubicación</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lot.packings.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.product.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.units}</TableCell>
                      <TableCell className="text-right">
                        <Kg value={p.kg} />
                      </TableCell>
                      <TableCell>{p.location.code}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap gap-2">
              {products.map((p) => (
                <Button key={p.id} variant="outline" asChild>
                  <Link href={`/produccion/lotes/${lot.code}/etiqueta?producto=${p.id}&copias=1`}>
                    <Printer /> Etiqueta de {p.name}
                  </Link>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
