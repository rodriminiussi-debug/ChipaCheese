import Link from "next/link";
import { Siren, ThermometerSnowflake } from "lucide-react";
import { formatDateAR } from "@chipa/domain";
import { StatCard } from "@/components/app/stat-card";
import { formatTimeAR } from "@/lib/dates";
import { tempLabel } from "../labels";
import type { QualityAlerts, heldLots, missingTemperaturesToday, recentOutOfRange } from "../service";

/** Alertas de calidad (RF-38): temperaturas fuera de rango, lecturas faltantes, reclamos y lotes retenidos. */
export function QualityAlertsPanel({
  alerts,
  outOfRange,
  missing,
  held,
}: {
  alerts: QualityAlerts;
  outOfRange: Awaited<ReturnType<typeof recentOutOfRange>>;
  missing: Awaited<ReturnType<typeof missingTemperaturesToday>>;
  held: Awaited<ReturnType<typeof heldLots>>;
}) {
  return (
    <div className="mb-6 space-y-4">
      {outOfRange.length ? (
        <div
          role="alert"
          data-testid="alert-out-of-range"
          className="border-destructive/50 bg-destructive/5 flex items-start gap-3 rounded-lg border p-4 text-sm"
        >
          <Siren className="text-destructive mt-0.5 size-5 shrink-0" />
          <div className="space-y-1">
            <p className="text-destructive font-semibold">
              Temperatura fuera de rango ({outOfRange.length} lectura{outOfRange.length === 1 ? "" : "s"} hoy
              o ayer)
            </p>
            <ul className="space-y-0.5">
              {outOfRange.map((o) => (
                <li key={o.id}>
                  <strong>{o.equipmentCode}</strong> {tempLabel(o.valueC)} · {formatDateAR(o.date)}{" "}
                  {formatTimeAR(o.measuredAt)} · {o.correctiveAction ?? "sin acción correctiva"}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {missing.length ? (
        <div
          role="status"
          data-testid="alert-missing-temperatures"
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40"
        >
          <ThermometerSnowflake className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <p>
            <strong>Faltan lecturas de temperatura de hoy:</strong> {missing.map((m) => m.code).join(", ")}.
          </p>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Fuera de rango (24 h)"
          value={alerts.outOfRangeLast24h}
          tone={alerts.outOfRangeLast24h ? "bad" : "good"}
          testId="stat-out-of-range"
        />
        <StatCard
          title="Temperaturas faltantes hoy"
          value={alerts.missingTemperaturesToday}
          tone={alerts.missingTemperaturesToday ? "warn" : "good"}
          testId="stat-missing-temperatures"
        />
        <StatCard
          title="Limpieza del mes"
          value={alerts.cleaningComplianceMonthPct == null ? "—" : `${alerts.cleaningComplianceMonthPct}%`}
          tone={
            alerts.cleaningComplianceMonthPct == null
              ? "default"
              : alerts.cleaningComplianceMonthPct >= 90
                ? "good"
                : "warn"
          }
          hint="Días hábiles registrados hasta ayer"
          testId="stat-cleaning-compliance"
        />
        <Link href="/calidad/reclamos" className="contents">
          <StatCard
            title="Reclamos abiertos"
            value={alerts.openComplaints}
            tone={alerts.openComplaints ? "warn" : "good"}
            testId="stat-open-complaints"
          />
        </Link>
        <StatCard
          title="Lotes retenidos"
          value={alerts.lotsOnHold}
          tone={alerts.lotsOnHold ? "bad" : "good"}
          hint={held.map((h) => h.code).join(", ") || undefined}
          testId="stat-lots-on-hold"
        />
      </div>
    </div>
  );
}
