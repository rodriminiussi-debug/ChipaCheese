import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, Repeat } from "lucide-react";
import { formatDateAR } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { Money } from "@/components/app/format";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { can } from "@/lib/rbac";
import { todayAR } from "@/lib/dates";
import { equipmentHistory, maintenanceFormOptions } from "@/features/maintenance/service";
import { downtimeLabel } from "@/features/maintenance/labels";
import { PlansTable } from "@/features/maintenance/components/plans-table";
import { OrdersTable } from "@/features/maintenance/components/orders-table";
import { CorrectiveForm } from "@/features/maintenance/components/corrective-form";

export const metadata = { title: "Mantenimiento · Equipo" };

export default async function EquipmentHistoryPage(props: PageProps<"/mantenimiento/equipos/[id]">) {
  const user = await requirePermission("maintenance:read");
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const today = todayAR();
  const history = await equipmentHistory(db, id, today);
  if (!history) notFound();
  const options = can(user.role, "maintenance:write") ? await maintenanceFormOptions(db) : null;
  const { equipment, plans, orders, repeated, totals } = history;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href={"/mantenimiento?vista=equipos" as Route}>
          <ArrowLeft /> Equipos
        </Link>
      </Button>
      <PageHeader
        title={equipment.name}
        description={`${equipment.area} · historial de trabajos de mantenimiento`}
        actions={
          options ? (
            <CorrectiveForm options={options} today={today} defaultEquipmentId={equipment.id} />
          ) : null
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Correctivos"
          value={totals.correctives}
          tone={totals.correctives >= 3 ? "warn" : "default"}
        />
        <StatCard title="Costo de correctivos" value={<Money value={totals.cost} />} />
        <StatCard title="Parada acumulada" value={downtimeLabel(totals.downtimeMinutes || null)} />
      </div>

      {repeated.length ? (
        <div
          role="alert"
          data-testid="repeated-failures"
          className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40"
        >
          <Repeat className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <p className="font-medium">Fallas repetidas</p>
            <ul>
              {repeated.map((r) => (
                <li key={r.label}>
                  <strong>{r.label}</strong>: {r.count} veces ({r.dates.map(formatDateAR).join(", ")})
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              Una falla que vuelve es candidata a plan preventivo o a cambio de repuesto.
            </p>
          </div>
        </div>
      ) : null}

      <h2 className="mb-2 text-lg font-semibold">Planes preventivos</h2>
      <div className="mb-6">
        {plans.length === 0 ? (
          <EmptyState title="Este equipo no tiene plan preventivo" />
        ) : (
          <PlansTable plans={plans} today={today} options={options} showEquipment={false} />
        )}
      </div>

      <h2 className="mb-2 text-lg font-semibold">Historial de trabajos</h2>
      {orders.length === 0 ? (
        <EmptyState title="Sin trabajos registrados" />
      ) : (
        <OrdersTable orders={orders} today={today} options={options} showEquipment={false} />
      )}
    </>
  );
}
