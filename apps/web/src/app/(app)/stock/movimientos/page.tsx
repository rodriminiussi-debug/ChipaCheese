import Link from "next/link";
import type { Route } from "next";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MovementsTable } from "@/features/stock/components/movements-table";
import { MOVEMENT_TYPE } from "@/features/stock/labels";
import { MOVEMENT_PAGE_SIZE } from "@/features/stock/schemas";
import { listMovements, stockFilterOptions, type MovementFilters } from "@/features/stock/service";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Stock · Movimientos" };

const SELECT =
  "border-input bg-background h-8 w-full min-w-0 rounded-lg border px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function MovementsPage(props: PageProps<"/stock/movimientos">) {
  await requirePermission("stock:read");
  const sp = await props.searchParams;
  const type = one(sp.type);
  const item = one(sp.item);
  const lot = one(sp.lot)?.trim() || undefined;
  const from = one(sp.from);
  const to = one(sp.to);
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const filters: MovementFilters = {
    type: type && type in MOVEMENT_TYPE ? (type as MovementFilters["type"]) : undefined,
    ingredientId: item?.startsWith("i:") && UUID.test(item.slice(2)) ? item.slice(2) : undefined,
    productId: item?.startsWith("p:") && UUID.test(item.slice(2)) ? item.slice(2) : undefined,
    lot,
    from: from && ISO.test(from) ? from : undefined,
    to: to && ISO.test(to) ? to : undefined,
  };
  const [result, options] = await Promise.all([
    listMovements(db, filters, page, MOVEMENT_PAGE_SIZE),
    stockFilterOptions(db),
  ]);

  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (type) u.set("type", type);
    if (item) u.set("item", item);
    if (lot) u.set("lot", lot);
    if (from) u.set("from", from);
    if (to) u.set("to", to);
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return `/stock/movimientos${s ? `?${s}` : ""}` as Route;
  };

  return (
    <div className="grid gap-4">
      <form
        className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-6"
        aria-label="Filtros de movimientos"
      >
        <label className="grid gap-1 text-sm">
          Tipo
          <select name="type" defaultValue={type ?? ""} className={SELECT}>
            <option value="">Todos</option>
            {Object.entries(MOVEMENT_TYPE).map(([v, t]) => (
              <option key={v} value={v}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm lg:col-span-2">
          Insumo o producto
          <select name="item" defaultValue={item ?? ""} className={SELECT}>
            <option value="">Todos</option>
            <optgroup label="Materia prima">
              {options.ingredients.map((i) => (
                <option key={i.id} value={`i:${i.id}`}>
                  {i.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Producto terminado">
              {options.products.map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Lote
          <Input name="lot" defaultValue={lot} placeholder="Código de lote" />
        </label>
        <label className="grid gap-1 text-sm">
          Desde
          <Input type="date" name="from" defaultValue={from} />
        </label>
        <label className="grid gap-1 text-sm">
          Hasta
          <Input type="date" name="to" defaultValue={to} />
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
          <Button type="submit">Filtrar</Button>
          <Button asChild variant="outline">
            <Link href={"/stock/movimientos" as Route}>Limpiar</Link>
          </Button>
        </div>
      </form>

      {result.rows.length ? (
        <MovementsTable rows={result.rows} />
      ) : (
        <EmptyState title="No hay movimientos" description="Probá con otros filtros." />
      )}

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {result.total} movimiento{result.total === 1 ? "" : "s"} · página {result.page} de{" "}
          {result.pageCount}
        </span>
        <div className="flex gap-2">
          {result.page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={qs(result.page - 1)}>Anterior</Link>
            </Button>
          ) : null}
          {result.page < result.pageCount ? (
            <Button asChild variant="outline" size="sm">
              <Link href={qs(result.page + 1)}>Siguiente</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
