import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { todayAR } from "@/lib/dates";
import { RunForm } from "@/features/production/components/run-form";
import { runFormOptions } from "@/features/production/service";

export const metadata = { title: "Nueva producción" };

export default async function NewRunPage() {
  const user = await requirePermission("production:write");
  const options = await runFormOptions(db);
  const defaultResponsible =
    options.users.find((u) => u.id === user.id) ??
    options.users.find((u) => u.role === "production_manager") ??
    options.users[0];

  return (
    <>
      <PageHeader
        title="Nueva producción"
        description="RF-20 · Una producción es una receta elaborada en el día (75 kg de fécula en dos tandas). El número del día y el lote se asignan solos."
      />
      <RunForm options={options} today={todayAR()} defaultResponsibleId={defaultResponsible?.id ?? ""} />
    </>
  );
}
