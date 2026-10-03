import Link from "next/link";
import type { Route } from "next";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { can } from "@/lib/rbac";
import { formatTimeAR, todayAR } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  cleaningMonth,
  getQualityAlerts,
  heldLots,
  missingTemperaturesToday,
  recentOutOfRange,
  temperatureEquipment,
  temperatureMonth,
} from "@/features/quality/service";
import { QualityAlertsPanel } from "@/features/quality/components/quality-alerts";
import { CleaningGrid, type GridRowView } from "@/features/quality/components/cleaning-grid";
import { TemperatureMonthView } from "@/features/quality/components/temperature-month";
import { BackdatedTemperature } from "@/features/quality/components/backdated-temperature";
import { MonthNav, parseMonth } from "@/features/quality/components/month-nav";
import { CLEANING_RESULT } from "@/features/quality/labels";

export const metadata = { title: "Calidad · Registros BPM" };

export default async function QualityPage(props: PageProps<"/calidad">) {
  const user = await requirePermission("quality:read");
  const sp = await props.searchParams;
  const today = todayAR();
  const month = parseMonth(sp.mes, today);
  const view = sp.vista === "temperaturas" ? "temperaturas" : "limpieza";
  const canWrite = can(user.role, "quality:write");

  const [alerts, outOfRange, missing, held] = await Promise.all([
    getQualityAlerts(db, today),
    recentOutOfRange(db, today),
    missingTemperaturesToday(db, today),
    heldLots(db),
  ]);

  const tabHref = (v: string) => `/calidad?vista=${v}&mes=${month}` as Route;

  return (
    <>
      <PageHeader
        title="Registros BPM"
        description="Limpieza y temperaturas con usuario, fecha y hora. Las cargas de días pasados quedan marcadas como tardías (RF-34)."
        actions={
          can(user.role, "export") ? (
            <Button asChild variant="outline">
              <Link href={"/calidad/exportar" as Route}>
                <Download /> Exportar
              </Link>
            </Button>
          ) : null
        }
      />
      <QualityAlertsPanel alerts={alerts} outOfRange={outOfRange} missing={missing} held={held} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="bg-muted inline-flex rounded-lg p-1 text-sm" role="tablist" aria-label="Vista">
          {(
            [
              ["limpieza", "Limpieza"],
              ["temperaturas", "Temperaturas"],
            ] as const
          ).map(([v, label]) => (
            <Link
              key={v}
              href={tabHref(v)}
              role="tab"
              aria-selected={view === v}
              className={cn(
                "rounded-md px-3 py-1.5 font-medium",
                view === v ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </div>
        <MonthNav basePath="/calidad" month={month} extra={{ vista: view }} />
      </div>

      {view === "limpieza" ? (
        <CleaningSection month={month} today={today} canWrite={canWrite} />
      ) : (
        <TemperatureSection month={month} today={today} canWrite={canWrite} />
      )}
    </>
  );
}

async function CleaningSection({
  month,
  today,
  canWrite,
}: {
  month: string;
  today: string;
  canWrite: boolean;
}) {
  const data = await cleaningMonth(db, month, today);
  const rows: GridRowView[] = data.rows.map((r) => ({
    pointId: r.pointId,
    sector: r.sector,
    element: r.element,
    gaps: r.gaps,
    cells: Object.fromEntries(
      Object.entries(r.cells).map(([d, c]) => [
        d,
        {
          result: c.result,
          lateEntry: c.lateEntry,
          title: `${CLEANING_RESULT[c.result]!.label} · ${c.userInitials ?? "?"} ${formatTimeAR(c.recordedAt)}${c.lateEntry ? " · carga tardía" : ""}${c.notes ? ` · ${c.notes}` : ""}`,
        },
      ]),
    ),
  }));
  const gapCount = data.rows.reduce((a, r) => a + r.gaps.length, 0);
  return (
    <div className="space-y-3">
      <div
        className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm"
        data-testid="cleaning-summary"
      >
        <span>
          Cumplimiento del mes:{" "}
          <strong className="text-foreground">
            {data.compliancePct == null ? "—" : `${data.compliancePct}%`}
          </strong>
        </span>
        <span>
          Huecos: <strong className={gapCount ? "text-destructive" : "text-foreground"}>{gapCount}</strong>
        </span>
      </div>
      <CleaningGrid days={data.days} rows={rows} today={today} canWrite={canWrite} />
    </div>
  );
}

async function TemperatureSection({
  month,
  today,
  canWrite,
}: {
  month: string;
  today: string;
  canWrite: boolean;
}) {
  const [data, equipment] = await Promise.all([temperatureMonth(db, month, today), temperatureEquipment(db)]);
  const names = Object.fromEntries(equipment.map((e) => [e.id, `${e.code} — ${e.name}`]));
  return (
    <div className="space-y-4">
      {canWrite ? (
        <div className="flex justify-end">
          <BackdatedTemperature equipment={equipment} today={today} />
        </div>
      ) : null}
      <TemperatureMonthView data={data} today={today} names={names} />
    </div>
  );
}
