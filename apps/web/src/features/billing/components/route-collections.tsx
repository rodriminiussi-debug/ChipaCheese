import { Money } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { PAYMENT_METHOD } from "@/lib/labels";
import { PaymentDialog } from "./payment-dialog";
import type { RouteCollections } from "../service";

/** RF-31: clientes de la ruta con su saldo y botón "Cobrar". Mobile first: tarjetas con botones grandes. */
export function RouteCollectionsList({ data, today }: { data: RouteCollections; today: string }) {
  return (
    <div className="grid gap-4">
      <section aria-label="Cobrado en ruta" className="bg-card rounded-xl border p-4">
        <div className="text-muted-foreground text-sm">Cobrado en esta ruta</div>
        <div className="text-3xl font-semibold tabular-nums" data-testid="route-collected">
          <Money value={data.collectedTotal} />
        </div>
        {Object.keys(data.collectedByMethod).length > 0 ? (
          <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 text-sm">
            {Object.entries(data.collectedByMethod).map(([m, v]) => (
              <span key={m}>
                {PAYMENT_METHOD[m] ?? m}: <Money value={v} />
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {data.stops.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          Esta ruta no tiene paradas con clientes.
        </p>
      ) : (
        <ul className="grid gap-3" aria-label="Clientes de la ruta">
          {data.stops.map((s) => (
            <li
              key={s.customerId}
              className="bg-card grid gap-3 rounded-xl border p-4"
              data-customer={s.legalName}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">{s.legalName}</div>
                  <div className="text-muted-foreground text-sm">
                    Parada {s.seq}
                    {s.paymentTermsDays ? ` · plazo ${s.paymentTermsDays} días` : " · contado"}
                  </div>
                </div>
                {s.collectedOnRoute > 0 ? (
                  <StatusBadge tone="good">
                    Cobró <Money value={s.collectedOnRoute} />
                  </StatusBadge>
                ) : null}
              </div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-muted-foreground text-xs">Saldo</div>
                  <div className="text-2xl font-semibold tabular-nums">
                    <Money value={s.balance} />
                  </div>
                  {s.overdue > 0 ? (
                    <div className="text-destructive text-sm">
                      Vencido <Money value={s.overdue} />
                    </div>
                  ) : null}
                </div>
                <PaymentDialog
                  customerId={s.customerId}
                  customerName={s.legalName}
                  routeId={data.route.id}
                  today={today}
                  variant="route"
                  label="Cobrar"
                  balance={s.balance}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
