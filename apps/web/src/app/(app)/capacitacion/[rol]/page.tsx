import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, Printer } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { findRole } from "@/features/training/content";
import { getUserProgress, roleCompletion } from "@/features/training/service";
import { ProgressBar } from "@/features/training/components/progress-bar";
import { RichText } from "@/features/training/components/rich-text";

export default async function TrainingRolePage(props: PageProps<"/capacitacion/[rol]">) {
  const user = await requirePermission("training:read");
  const { rol } = await props.params;
  const role = findRole(rol);
  if (!role) notFound();
  const progress = await getUserProgress(db, user.id);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={role.title}
        description={[role.who, role.device].filter(Boolean).join(" · ")}
        actions={
          <Link
            href={`/capacitacion/${role.id}/ficha` as Route}
            className="hover:bg-muted inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium"
          >
            <Printer className="size-4" /> Ficha para imprimir
          </Link>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {role.goal ? (
          <p className="bg-secondary text-secondary-foreground rounded-xl p-4 text-sm">
            <span className="block text-xs font-semibold tracking-wide uppercase">Para qué</span>
            {role.goal}
          </p>
        ) : null}
        {role.permissions ? (
          <p className="bg-muted rounded-xl p-4 text-sm">
            <span className="block text-xs font-semibold tracking-wide uppercase">Qué podés ver y hacer</span>
            {role.permissions}
          </p>
        ) : null}
      </div>
      <ProgressBar {...roleCompletion(progress, role.id)} className="max-w-sm" />
      <ol className="grid gap-3">
        {role.modules.map((m, i) => {
          const p = progress[`${role.id}/${m.id}`];
          return (
            <li key={m.id}>
              <Link
                href={`/capacitacion/${role.id}/${m.id}` as Route}
                className="hover:bg-muted flex items-start gap-4 rounded-xl border p-4"
              >
                <span className="bg-brand-yellow text-brand-ink grid size-9 shrink-0 place-items-center rounded-full font-semibold tabular-nums">
                  {i + 1}
                </span>
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="font-medium">{m.title}</span>
                  {m.why ? (
                    <span className="text-muted-foreground text-sm">
                      <RichText text={m.why} />
                    </span>
                  ) : null}
                  <span className="text-muted-foreground text-xs">
                    {m.steps.length} pasos{m.check.length ? ` · ${m.check.length} preguntas` : ""}
                  </span>
                </span>
                {p?.completedAt ? (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                    Aprobado
                  </span>
                ) : (
                  <ArrowRight className="text-muted-foreground mt-1 size-4 shrink-0" />
                )}
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
