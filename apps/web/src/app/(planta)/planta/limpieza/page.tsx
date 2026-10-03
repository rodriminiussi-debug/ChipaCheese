import { formatDateAR } from "@chipa/domain";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { todayAR, formatTimeAR } from "@/lib/dates";
import { cleaningChecklist } from "@/features/quality/service";
import { CleaningChecklist, type ChecklistItemView } from "@/features/quality/components/cleaning-checklist";

export const metadata = { title: "Limpieza" };

export default async function PlantCleaningPage() {
  await requirePermission("quality:record");
  const today = todayAR();
  const items = await cleaningChecklist(db, today);
  const view: ChecklistItemView[] = items.map((i) => ({
    pointId: i.pointId,
    sector: i.sector,
    element: i.element,
    frequency: i.frequency,
    status: i.status,
    result: i.result,
    notes: i.notes,
    userInitials: i.userInitials,
    doneLabel:
      i.status === "done" && i.recordedAt
        ? formatTimeAR(i.recordedAt)
        : i.doneDate
          ? formatDateAR(i.doneDate).slice(0, 5)
          : null,
  }));
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Limpieza de hoy</h1>
      <p className="text-muted-foreground text-lg">
        {formatDateAR(today)} · Marcá cada punto cuando lo limpiás. Lo semanal se pide una vez por semana.
      </p>
      <CleaningChecklist items={view} />
    </div>
  );
}
