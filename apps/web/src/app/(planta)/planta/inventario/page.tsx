import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft } from "lucide-react";
import { DateText } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { CountEntry } from "@/features/stock/components/count-entry";
import { PlantNewCount } from "@/features/stock/components/plant-new-count";
import { getInventoryCount, listInventoryCounts } from "@/features/stock/inventory";
import { COUNT_STATUS, ITEM_KIND } from "@/features/stock/labels";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Contar inventario" };

/**
 * Modo planta: contar el inventario físico en la tablet. Se abre un conteo (precargado con el saldo del
 * sistema) y se guarda el avance; confirmar el ajuste lo hace la jefa (`stock:write`).
 */
export default async function PlantInventoryPage(props: PageProps<"/planta/inventario">) {
  const user = await requirePermission("stock:count");
  const sp = await props.searchParams;
  const detail = typeof sp.id === "string" ? await getInventoryCount(db, sp.id) : null;
  const canConfirm = can(user.role, "stock:write");

  const back = (
    <Link
      href={(detail ? "/planta/inventario" : "/planta") as Route}
      className="flex h-14 items-center gap-2 rounded-lg border px-4 text-lg font-medium"
    >
      <ArrowLeft /> {detail ? "Inventarios" : "Inicio"}
    </Link>
  );

  if (detail) {
    const { count } = detail;
    const st = COUNT_STATUS[count.status] ?? { label: count.status, tone: "neutral" as const };
    const editable = count.status === "draft";
    return (
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex flex-wrap items-center gap-3 text-3xl font-bold">
            Inventario de {ITEM_KIND[count.itemKind].toLowerCase()}
            <StatusBadge tone={st.tone} className="px-3 py-1 text-base">
              {st.label}
            </StatusBadge>
          </h1>
          {back}
        </div>
        {editable ? (
          <>
            <p className="text-muted-foreground text-lg">
              Cargá lo que contás en cada posición y tocá “Guardar avance”; podés seguir después.
              {canConfirm ? "" : " La jefa de producción confirma el inventario y se ajusta el stock."}
            </p>
            <CountEntry countId={count.id} items={detail.items} variant="plant" canConfirm={canConfirm} />
          </>
        ) : (
          <p className="bg-card rounded-xl border p-6 text-xl">
            {count.status === "confirmed"
              ? "Este inventario ya fue confirmado y las diferencias quedaron ajustadas."
              : "Este inventario fue anulado."}
          </p>
        )}
      </div>
    );
  }

  const counts = await listInventoryCounts(db);
  const open = counts.filter((c) => c.status === "draft");
  const openKinds = new Set(open.map((c) => c.itemKind));
  const startable = (["ingredient", "product"] as const).filter((k) => !openKinds.has(k));
  const recent = counts.filter((c) => c.status !== "draft").slice(0, 5);
  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Contar inventario</h1>
        {back}
      </div>

      <section className="grid gap-3" aria-label="Conteos en curso">
        <h2 className="text-xl font-semibold">Conteos en curso</h2>
        {open.length === 0 ? (
          <p className="bg-card rounded-xl border p-5 text-xl">No hay conteos abiertos. Empezá uno abajo.</p>
        ) : (
          open.map((c) => (
            <Link
              key={c.id}
              href={`/planta/inventario?id=${c.id}` as Route}
              data-testid="open-count"
              className="bg-card hover:bg-accent flex min-h-20 items-center justify-between gap-3 rounded-xl border p-4 text-xl font-semibold shadow-sm"
            >
              <span>
                {ITEM_KIND[c.itemKind]} · <DateText value={c.date} />
                <span className="text-muted-foreground block text-base font-normal">
                  Contadas {c.counted} de {c.items}
                </span>
              </span>
              <span className="text-primary text-lg">Seguir contando</span>
            </Link>
          ))
        )}
      </section>

      {startable.length ? (
        <section className="grid gap-3" aria-label="Nuevo conteo">
          <h2 className="text-xl font-semibold">Empezar un conteo nuevo</h2>
          <PlantNewCount kinds={[...startable]} />
        </section>
      ) : null}

      {recent.length ? (
        <section className="grid gap-2" aria-label="Últimos inventarios">
          <h2 className="text-xl font-semibold">Últimos inventarios</h2>
          {recent.map((c) => {
            const st = COUNT_STATUS[c.status] ?? { label: c.status, tone: "neutral" as const };
            return (
              <p
                key={c.id}
                className="bg-card flex items-center justify-between rounded-xl border p-3 text-lg"
              >
                <span>
                  {ITEM_KIND[c.itemKind]} · <DateText value={c.date} /> · {c.counted} de {c.items} contadas
                </span>
                <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
              </p>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
