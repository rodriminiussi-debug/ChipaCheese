import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReportFaultForm } from "@/features/maintenance/components/report-fault-form";
import { faultEquipmentOptions } from "@/features/maintenance/service";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Avisar una falla" };

/** Modo planta: avisar que un equipo falla (botones grandes). Crea una correctiva abierta para Mantenimiento. */
export default async function PlantFaultPage(props: PageProps<"/planta/falla">) {
  await requirePermission("maintenance:report");
  const sp = await props.searchParams;
  const equipment = await faultEquipmentOptions(db);
  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Avisar una falla</h1>
        <Link
          href="/planta"
          className="flex h-14 items-center gap-2 rounded-lg border px-4 text-lg font-medium"
        >
          <ArrowLeft /> Inicio
        </Link>
      </div>
      <ReportFaultForm
        equipment={equipment}
        defaultEquipmentId={typeof sp.equipo === "string" ? sp.equipo : null}
        backHref="/planta"
      />
    </div>
  );
}
