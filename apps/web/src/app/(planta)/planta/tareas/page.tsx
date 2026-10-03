import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { formatDateAR } from "@chipa/domain";
import { StatusBadge } from "@/components/app/status-badge";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { todayAR } from "@/lib/dates";
import { myTasks } from "@/features/people/service";
import { STAGE_ORDER, TASK_STAGE } from "@/features/people/labels";

export const metadata = { title: "Mis tareas de hoy" };

/** Modo planta: las tareas del pizarrón asignadas a la persona que entró con su PIN. */
export default async function PlantTasksPage() {
  const user = await requirePermission("production:record");
  const today = todayAR();
  const tasks = await myTasks(db, user.id, today);

  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Mis tareas de hoy</h1>
        <Link
          href="/planta"
          className="flex h-14 items-center gap-2 rounded-lg border px-4 text-lg font-medium"
        >
          <ArrowLeft /> Inicio
        </Link>
      </div>
      <p className="text-muted-foreground text-lg">
        {user.name} · {formatDateAR(today)}
      </p>
      {tasks.length === 0 ? (
        <p className="bg-card rounded-xl border p-6 text-xl">
          Todavía no tenés tareas asignadas para hoy. Consultá con la jefa de producción.
        </p>
      ) : (
        STAGE_ORDER.map((stage) => {
          const list = tasks.filter((t) => t.stage === stage);
          if (!list.length) return null;
          return (
            <section key={stage} className="grid gap-3" aria-label={TASK_STAGE[stage]}>
              <h2 className="text-muted-foreground text-xl font-semibold">{TASK_STAGE[stage]}</h2>
              {list.map((t) => (
                <article
                  key={t.taskId}
                  className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border p-5 shadow-sm"
                >
                  <div>
                    <p className="text-2xl font-semibold">{t.name}</p>
                    {t.with.length ? (
                      <p className="text-muted-foreground text-lg">Con {t.with.join(", ")}</p>
                    ) : null}
                    {t.notes ? <p className="text-lg">{t.notes}</p> : null}
                  </div>
                  {t.critical ? (
                    <StatusBadge tone="warn" className="gap-1 px-3 py-1 text-base">
                      <AlertTriangle className="size-4" /> Tarea crítica
                    </StatusBadge>
                  ) : null}
                </article>
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}
