import Link from "next/link";
import type { Route } from "next";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { can } from "@/lib/rbac";
import { todayAR } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { DateText } from "@/components/app/format";
import {
  equipmentSummaries,
  getMaintenanceAlerts,
  listOrders,
  listPlans,
  maintenanceFormOptions,
} from "@/features/maintenance/service";
import { PLAN_STATUS, downtimeLabel } from "@/features/maintenance/labels";
import { PlansTable } from "@/features/maintenance/components/plans-table";
import { OrdersTable } from "@/features/maintenance/components/orders-table";
import { PlanForm } from "@/features/maintenance/components/plan-form";
import { CorrectiveForm } from "@/features/maintenance/components/corrective-form";

export const metadata = { title: "Mantenimiento" };

const VIEWS = [
  ["planes", "Planes preventivos"],
  ["correctivos", "Correctivos"],
  ["equipos", "Equipos"],
] as const;

export default async function MaintenancePage(props: PageProps<"/mantenimiento">) {
  const user = await requirePermission("maintenance:read");
  const sp = await props.searchParams;
  const view = VIEWS.find(([v]) => v === sp.vista)?.[0] ?? "planes";
  const estado = sp.estado === "open" || sp.estado === "done" ? sp.estado : undefined;
  const today = todayAR();
  const canWrite = can(user.role, "maintenance:write");

  const [alerts, options] = await Promise.all([
    getMaintenanceAlerts(db, today),
    canWrite ? maintenanceFormOptions(db) : null,
  ]);

  return (
    <>
      <PageHeader
        title="Mantenimiento"
        description="Plan preventivo por equipo con avisos de vencimiento, y órdenes correctivas con causa, repuesto y costo (RF-37)."
        actions={
          options ? (
            <>
              <PlanForm options={options} today={today} />
              <CorrectiveForm options={options} today={today} />
            </>
          ) : null
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Preventivos vencidos"
          value={alerts.overdue}
          tone={alerts.overdue ? "bad" : "good"}
          testId="stat-overdue"
        />
        <StatCard
          title="Por vencer (7 días)"
          value={alerts.dueSoon}
          tone={alerts.dueSoon ? "warn" : "good"}
          testId="stat-due-soon"
        />
        <StatCard
          title="Preventivos cumplidos del mes"
          value={alerts.preventiveCompliancePct == null ? "—" : `${alerts.preventiveCompliancePct}%`}
          tone={
            alerts.preventiveCompliancePct == null
              ? "default"
              : alerts.preventiveCompliancePct >= 90
                ? "good"
                : "warn"
          }
          hint="Hechos ÷ programados del mes"
          testId="stat-compliance"
        />
        <StatCard
          title="Correctivos abiertos"
          value={alerts.openCorrectives}
          tone={alerts.openCorrectives ? "warn" : "good"}
          testId="stat-open-correctives"
        />
      </div>

      <nav aria-label="Vistas de mantenimiento" className="mb-4 flex gap-1 border-b">
        {VIEWS.map(([v, label]) => (
          <Link
            key={v}
            href={`/mantenimiento?vista=${v}` as Route}
            aria-current={view === v ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              view === v
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {view === "planes" ? <PlansView today={today} options={options} /> : null}
      {view === "correctivos" ? <CorrectivesView today={today} options={options} estado={estado} /> : null}
      {view === "equipos" ? <EquipmentView today={today} /> : null}
    </>
  );
}

async function PlansView({
  today,
  options,
}: {
  today: string;
  options: Awaited<ReturnType<typeof maintenanceFormOptions>> | null;
}) {
  const plans = await listPlans(db, { today, includeInactive: !!options });
  if (plans.length === 0)
    return (
      <EmptyState
        title="Todavía no hay planes preventivos"
        description="Creá el primero con la frecuencia de cada equipo."
      />
    );
  return <PlansTable plans={plans} today={today} options={options} />;
}

async function CorrectivesView({
  today,
  options,
  estado,
}: {
  today: string;
  options: Awaited<ReturnType<typeof maintenanceFormOptions>> | null;
  estado?: "open" | "done";
}) {
  const orders = await listOrders(db, { type: "corrective", status: estado });
  const filters = [
    [undefined, "Todas"],
    ["open", "Abiertas"],
    ["done", "Cerradas"],
  ] as const;
  return (
    <div className="space-y-4">
      <div className="bg-muted inline-flex rounded-lg p-1 text-sm">
        {filters.map(([v, label]) => (
          <Link
            key={label}
            href={
              (v
                ? `/mantenimiento?vista=correctivos&estado=${v}`
                : "/mantenimiento?vista=correctivos") as Route
            }
            className={cn(
              "rounded-md px-3 py-1.5 font-medium",
              estado === v ? "bg-background shadow-sm" : "text-muted-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </div>
      {orders.length === 0 ? (
        <EmptyState title="No hay órdenes correctivas" />
      ) : (
        <OrdersTable orders={orders} today={today} options={options} />
      )}
    </div>
  );
}

async function EquipmentView({ today }: { today: string }) {
  const rows = await equipmentSummaries(db, today);
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Equipo</TableHead>
            <TableHead>Área</TableHead>
            <TableHead className="text-right">Planes</TableHead>
            <TableHead>Preventivos</TableHead>
            <TableHead className="text-right">Correctivos</TableHead>
            <TableHead className="text-right">Abiertos</TableHead>
            <TableHead>Último correctivo</TableHead>
            <TableHead className="text-right">Parada total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((e) => (
            <TableRow key={e.id}>
              <TableCell>
                <Link
                  href={`/mantenimiento/equipos/${e.id}` as Route}
                  className="font-medium hover:underline"
                >
                  {e.name}
                </Link>
              </TableCell>
              <TableCell>{e.area}</TableCell>
              <TableCell className="text-right tabular-nums">{e.plans}</TableCell>
              <TableCell>
                {e.worstStatus ? (
                  <StatusBadge tone={PLAN_STATUS[e.worstStatus].tone}>
                    {PLAN_STATUS[e.worstStatus].label}
                  </StatusBadge>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {e.correctives >= 3 ? (
                  <span className="text-destructive font-semibold">{e.correctives}</span>
                ) : (
                  e.correctives
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{e.openCorrectives}</TableCell>
              <TableCell>
                <DateText value={e.lastCorrective} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {downtimeLabel(e.downtimeMinutes || null)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
