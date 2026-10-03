import Link from "next/link";
import { Download } from "lucide-react";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { DateText, Money, Num } from "@/components/app/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { ingredientPriceHistory } from "@/features/purchases/service";
import { PriceChart } from "@/features/purchases/components/price-chart";
import { monthLabel } from "@/features/purchases/labels";
import { UNIT } from "@/lib/labels";

const Variation = ({ value }: { value: number | null }) =>
  value == null ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <Num
      value={value}
      suffix="%"
      className={value > 0 ? "text-destructive" : value < 0 ? "text-emerald-600" : ""}
    />
  );

export default async function IngredientPricePage(props: PageProps<"/compras/precios/[id]">) {
  await requirePermission("purchases:read");
  const { id } = await props.params;
  const h = await ingredientPriceHistory(db, id);
  if (!h) notFound();

  return (
    <>
      <PageHeader
        title={h.ingredient.name}
        description={`Precio neto (sin IVA) por ${UNIT[h.ingredient.unit]}, por proveedor y en el tiempo.`}
        actions={
          <>
            <Link href="/compras/precios" className="text-muted-foreground text-sm hover:underline">
              ← Todos los insumos
            </Link>
            <Button asChild variant="outline">
              <a href={`/compras/precios/exportar?insumo=${h.ingredient.id}`} download>
                <Download /> Exportar a Excel
              </a>
            </Button>
          </>
        }
      />
      {h.history.length === 0 ? (
        <EmptyState
          title="Sin compras registradas"
          description="El historial se arma al confirmar facturas de compra."
        />
      ) : (
        <div className="grid gap-8">
          <section>
            <h2 className="mb-2 text-lg font-semibold">Evolución</h2>
            <PriceChart series={h.suppliers.map((s) => ({ key: s.key, name: s.name, points: s.points }))} />
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">Comparación entre proveedores</h2>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Proveedor</TableHead>
                    <TableHead className="text-right">Último precio</TableHead>
                    <TableHead className="text-right">Contra el más barato</TableHead>
                    <TableHead className="hidden sm:table-cell">Fecha</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Compras</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {h.suppliers.map((s) => (
                    <TableRow key={s.key}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-right">
                        <Money value={s.lastPrice} />
                      </TableCell>
                      <TableCell className="text-right">
                        {s.vsCheapestPct ? (
                          <Num value={s.vsCheapestPct} suffix="%" />
                        ) : (
                          <span className="text-emerald-600">El más barato</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <DateText value={s.lastDate} />
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {s.purchases}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          <section className="grid gap-8 lg:grid-cols-2">
            <div>
              <h2 className="mb-2 text-lg font-semibold">Variación mensual</h2>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mes</TableHead>
                      <TableHead className="text-right">Último precio</TableHead>
                      <TableHead className="text-right">Variación</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...h.monthly].reverse().map((m) => (
                      <TableRow key={m.month}>
                        <TableCell>{monthLabel(m.month)}</TableCell>
                        <TableCell className="text-right">
                          <Money value={m.price} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Variation value={m.variationPct} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div>
              <h2 className="mb-2 text-lg font-semibold">Compras</h2>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Proveedor</TableHead>
                      <TableHead className="text-right">Precio neto</TableHead>
                      <TableHead className="text-right">vs anterior</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {h.history.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          {r.invoiceId ? (
                            <Link href={`/compras/facturas/${r.invoiceId}`} className="hover:underline">
                              <DateText value={r.date} />
                            </Link>
                          ) : (
                            <DateText value={r.date} />
                          )}
                        </TableCell>
                        <TableCell>{r.supplierName}</TableCell>
                        <TableCell className="text-right">
                          <Money value={r.unitPriceNet} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Variation value={r.variationPct} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
