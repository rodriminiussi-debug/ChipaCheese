import { ReplenishmentList } from "@/features/store/components/replenishment-list";
import { ReplenishmentSend } from "@/features/store/components/replenishment-send";
import { listReplenishments, plantStockByProduct } from "@/features/store/replenishment";
import { todayAR } from "@/lib/dates";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Stock · Reposición del local" };

/** La planta ve lo que pide el local y lo envía: transfiere F3/F4 → LOCAL por FEFO. */
export default async function ReplenishmentPage() {
  const user = await requirePermission("stock:read");
  const today = todayAR();
  const [pending, history] = await Promise.all([
    listReplenishments(db, { statuses: ["requested"], limit: 50 }),
    listReplenishments(db, { statuses: ["sent", "received", "cancelled"], limit: 15 }),
  ]);
  const plantStock = await plantStockByProduct(db, [
    ...new Set(pending.flatMap((r) => r.items.map((i) => i.productId))),
  ]);
  const canSend = can(user.role, "stock:write");

  return (
    <div className="grid gap-8">
      <section className="grid gap-3" aria-label="Pedidos pendientes">
        <div>
          <h2 className="text-lg font-semibold">Pedidos del local para enviar</h2>
          <p className="text-muted-foreground text-sm">
            Al enviar, el producto pasa de F3 / F4 al local (el más próximo a vencer primero). El local confirma
            cuando lo recibe.
          </p>
        </div>
        {pending.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
            No hay pedidos de reposición pendientes.
          </p>
        ) : canSend ? (
          pending.map((r) => (
            <ReplenishmentSend
              key={r.id}
              rep={r}
              today={today}
              plantStock={Object.fromEntries(
                r.items.map((i) => [i.productId, plantStock.get(i.productId) ?? 0]),
              )}
            />
          ))
        ) : (
          <ReplenishmentList rows={pending} canAct={false} />
        )}
      </section>
      <section className="grid gap-3" aria-label="Historial de pedidos">
        <h2 className="text-lg font-semibold">Últimos pedidos</h2>
        <ReplenishmentList rows={history} canAct={false} empty="Todavía no hay pedidos atendidos." />
      </section>
    </div>
  );
}
