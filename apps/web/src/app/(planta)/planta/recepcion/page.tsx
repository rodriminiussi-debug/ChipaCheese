import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft, PackagePlus, Truck } from "lucide-react";
import { formatNumber } from "@chipa/domain";
import { DateText } from "@/components/app/format";
import { PlantReception } from "@/features/purchases/components/plant-reception";
import { receivableOrders, receptionFormData } from "@/features/purchases/service";
import { UNIT } from "@/lib/labels";
import { todayAR } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Recibir mercadería" };

const TIMING: Record<string, { label: (d: number) => string; cls: string }> = {
  overdue: { label: (d) => `Atrasada ${d} ${d === 1 ? "día" : "días"}`, cls: "text-destructive" },
  today: { label: () => "Se espera hoy", cls: "text-emerald-700 dark:text-emerald-400" },
  upcoming: { label: (d) => `En ${d} ${d === 1 ? "día" : "días"}`, cls: "text-muted-foreground" },
  unscheduled: { label: () => "Sin fecha", cls: "text-muted-foreground" },
};

/** Modo planta: recibir mercadería. Elegir la orden esperada (o una entrega libre de un proveedor) y cargar lo que llegó. */
export default async function PlantReceptionPage(props: PageProps<"/planta/recepcion">) {
  await requirePermission("purchases:receive");
  const sp = await props.searchParams;
  const orderId = typeof sp.orden === "string" ? sp.orden : null;
  const freeSupplier = typeof sp.proveedor === "string" ? sp.proveedor : null;

  const back = (
    <Link
      href={orderId || freeSupplier ? "/planta/recepcion" : "/planta"}
      className="flex h-14 items-center gap-2 rounded-lg border px-4 text-lg font-medium"
    >
      <ArrowLeft /> {orderId || freeSupplier ? "Volver" : "Inicio"}
    </Link>
  );

  if (orderId || freeSupplier) {
    const data = await receptionFormData(db, orderId);
    const supplierId = data.order?.supplierId ?? freeSupplier ?? "";
    const valid = data.suppliers.some((s) => s.id === supplierId) && (!orderId || data.order);
    return (
      <div className="grid gap-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">
            {data.order ? `Recibir ${data.order.number}` : "Recibir mercadería"}
          </h1>
          {back}
        </div>
        {valid ? (
          <PlantReception data={data} supplierId={supplierId} />
        ) : (
          <p className="bg-card rounded-xl border p-6 text-xl">
            No encontré esa orden o proveedor. Volvé y elegí de nuevo.
          </p>
        )}
      </div>
    );
  }

  const today = todayAR();
  const [orders, data] = await Promise.all([receivableOrders(db, today), receptionFormData(db)]);
  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Recibir mercadería</h1>
        {back}
      </div>

      <section className="grid gap-3" aria-label="Órdenes esperadas">
        <h2 className="text-xl font-semibold">Órdenes de compra esperadas</h2>
        {orders.length === 0 ? (
          <p className="bg-card rounded-xl border p-5 text-xl">
            No hay órdenes enviadas pendientes de recibir.
          </p>
        ) : (
          orders.map((o) => {
            const t = TIMING[o.timing.state]!;
            return (
              <Link
                key={o.id}
                href={`/planta/recepcion?orden=${o.id}` as Route}
                data-testid="reception-order"
                className="bg-card hover:bg-accent grid gap-1 rounded-xl border p-4 shadow-sm"
              >
                <span className="flex flex-wrap items-center justify-between gap-2 text-2xl font-semibold">
                  <span className="flex items-center gap-3">
                    <Truck className="text-primary size-8" /> {o.supplier} · {o.number}
                  </span>
                  <span className={`text-lg font-medium ${t.cls}`}>
                    {t.label(o.timing.days)}
                    {o.expectedAt ? (
                      <>
                        {" · "}
                        <DateText value={o.expectedAt} />
                      </>
                    ) : null}
                  </span>
                </span>
                <span className="text-muted-foreground text-lg">
                  {o.lines.map((l) => `${formatNumber(l.pending, 3)} ${UNIT[l.unit]} ${l.name}`).join(" · ")}
                </span>
              </Link>
            );
          })
        )}
      </section>

      <section className="grid gap-3" aria-label="Entrega sin orden">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <PackagePlus className="size-6" /> Entrega sin orden de compra
        </h2>
        <p className="text-muted-foreground text-lg">Elegí el proveedor que trajo la mercadería:</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.suppliers.map((s) => (
            <Link
              key={s.id}
              href={`/planta/recepcion?proveedor=${s.id}` as Route}
              className="bg-card hover:bg-accent flex min-h-16 items-center rounded-xl border p-4 text-xl font-semibold shadow-sm"
            >
              {s.name}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
