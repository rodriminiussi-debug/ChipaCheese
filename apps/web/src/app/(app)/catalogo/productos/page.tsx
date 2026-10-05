import Link from "next/link";
import type { Route } from "next";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { NativeSelect } from "@/components/app/native-select";
import { StatusBadge } from "@/components/app/status-badge";
import { Num } from "@/components/app/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PRODUCT_KIND } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listProducts, type ProductKind } from "@/features/catalog/service";

export const metadata = { title: "Catálogo · Productos" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ProductsPage(props: PageProps<"/catalogo/productos">) {
  await requirePermission("catalog:write");
  const sp = await props.searchParams;
  const q = first(sp.q)?.trim() || undefined;
  const kindParam = first(sp.tipo);
  const kind = kindParam && kindParam in PRODUCT_KIND ? (kindParam as ProductKind) : undefined;
  const statusParam = first(sp.estado);
  const status = statusParam === "inactive" || statusParam === "all" ? statusParam : "active";
  const rows = await listProducts(db, { q, kind, status });

  return (
    <>
      <PageHeader
        title="Productos"
        description="Chipá fabricado, productos de reventa (gaseosas…) y elaborados en el local, con su equivalente en chipá."
        actions={
          <Button asChild>
            <Link href="/catalogo/productos/nuevo">
              <Plus /> Nuevo producto
            </Link>
          </Button>
        }
      />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <Input
          name="q"
          placeholder="Buscar por nombre, código o código de barras…"
          defaultValue={q}
          aria-label="Buscar productos"
          className="max-w-sm"
        />
        <div className="w-52">
          <NativeSelect name="tipo" defaultValue={kind ?? ""} aria-label="Filtrar por tipo">
            <option value="">Todos los tipos</option>
            {Object.entries(PRODUCT_KIND).map(([v, k]) => (
              <option key={v} value={v}>
                {k.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="w-40">
          <NativeSelect name="estado" defaultValue={status} aria-label="Filtrar por estado">
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
            <option value="all">Todos</option>
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No hay productos" description="Probá con otros filtros o cargá uno nuevo." />
      ) : (
        <div className="rounded-lg border">
          <Table aria-label="Productos">
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="hidden md:table-cell">Equivale a</TableHead>
                <TableHead className="hidden lg:table-cell">Código de barras</TableHead>
                <TableHead className="hidden sm:table-cell">Dónde se vende</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={`/catalogo/productos/${p.id}` as Route}
                      className="font-medium hover:underline"
                    >
                      {p.name}
                    </Link>
                    <div className="text-muted-foreground text-xs">
                      {p.code} · se cuenta en {p.unitLabel}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={p.kind === "manufactured" ? "info" : p.kind === "resale" ? "neutral" : "warn"}
                    >
                      {PRODUCT_KIND[p.kind]?.label}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {p.kind === "prepared" ? (
                      <>
                        <Num value={p.baseQty} decimals={2} /> × {p.baseName ?? "—"}
                        <div className="text-muted-foreground text-xs">
                          <Num value={p.netWeightKg} decimals={3} suffix="kg de masa" />
                        </div>
                      </>
                    ) : p.kind === "manufactured" ? (
                      <Num value={p.netWeightKg} decimals={3} suffix="kg de masa" />
                    ) : (
                      <span className="text-muted-foreground">{p.supplierName ?? "—"}</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs lg:table-cell">{p.barcode ?? "—"}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {[p.availableInStore ? "Local" : null, p.availableForOrders ? "Pedidos" : null]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={p.active ? "good" : "neutral"}>
                      {p.active ? "Activo" : "Inactivo"}
                    </StatusBadge>
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
