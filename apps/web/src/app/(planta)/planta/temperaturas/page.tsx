import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { todayAR, formatTimeAR } from "@/lib/dates";
import { temperatureStatusToday } from "@/features/quality/service";
import { tempLabel } from "@/features/quality/labels";
import { TemperaturePad, type EquipmentView } from "@/features/quality/components/temperature-pad";
import { formatDateAR } from "@chipa/domain";

export const metadata = { title: "Temperaturas" };

export default async function PlantTemperaturesPage() {
  await requirePermission("quality:record");
  const today = todayAR();
  const status = await temperatureStatusToday(db, today);
  const equipment: EquipmentView[] = status.map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
    min: e.min,
    max: e.max,
    lastValue: e.last?.valueC ?? null,
    lastOut: !!e.last?.outOfRange && e.last.date === today,
    doneToday: e.todayCount > 0,
    missing: e.missingToday,
    lastLabel: e.last
      ? `${tempLabel(e.last.valueC)} · ${e.last.date === today ? formatTimeAR(e.last.measuredAt) : formatDateAR(e.last.date).slice(0, 5)}`
      : null,
  }));
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Temperaturas</h1>
      <TemperaturePad equipment={equipment} />
    </div>
  );
}
