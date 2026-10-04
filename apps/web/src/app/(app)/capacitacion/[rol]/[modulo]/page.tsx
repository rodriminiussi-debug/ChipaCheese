import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { Lightbulb, TriangleAlert } from "lucide-react";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { findRole, screenshotUrl } from "@/features/training/content";
import { getUserProgress } from "@/features/training/service";
import { ModuleViewer } from "@/features/training/components/module-viewer";
import { Quiz } from "@/features/training/components/quiz";
import { RichText } from "@/features/training/components/rich-text";

export async function generateMetadata(props: PageProps<"/capacitacion/[rol]/[modulo]">) {
  const { rol, modulo } = await props.params;
  const mod = findRole(rol)?.modules.find((m) => m.id === modulo);
  return { title: mod ? `${mod.title} · Capacitación` : "Capacitación" };
}

export default async function TrainingModulePage(props: PageProps<"/capacitacion/[rol]/[modulo]">) {
  const user = await requirePermission("training:read");
  const { rol, modulo } = await props.params;
  const role = findRole(rol);
  const mod = role?.modules.find((m) => m.id === modulo);
  if (!role || !mod) notFound();
  const index = role.modules.indexOf(mod);
  const next = role.modules[index + 1];
  const progress = await getUserProgress(db, user.id);
  const done = progress[`${role.id}/${mod.id}`]?.completedAt;

  return (
    <article className="grid gap-8">
      <header className="grid gap-2">
        <nav className="text-muted-foreground text-sm" aria-label="Ubicación">
          <Link href={"/capacitacion" as Route} className="hover:underline">
            Capacitación
          </Link>{" "}
          /{" "}
          <Link href={`/capacitacion/${role.id}` as Route} className="hover:underline">
            {role.title}
          </Link>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {index + 1}. {mod.title}
        </h1>
        {mod.why ? (
          <p className="text-muted-foreground max-w-prose">
            <RichText text={mod.why} />
          </p>
        ) : null}
        {done ? (
          <span className="w-fit rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            Aprobado
          </span>
        ) : null}
      </header>

      <ModuleViewer
        steps={mod.steps.map((s) => ({ ...s, src: s.screenshot ? screenshotUrl(s.screenshot) : null }))}
      />

      {mod.tips.length || mod.mistakes.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {mod.tips.length ? (
            <section className="bg-secondary text-secondary-foreground grid content-start gap-2 rounded-xl p-4">
              <h2 className="flex items-center gap-2 font-semibold">
                <Lightbulb className="size-4" /> Consejos
              </h2>
              <ul className="grid list-disc gap-1 pl-5 text-sm">
                {mod.tips.map((t, i) => (
                  <li key={i}>
                    <RichText text={t} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {mod.mistakes.length ? (
            <section className="bg-muted grid content-start gap-2 rounded-xl p-4">
              <h2 className="flex items-center gap-2 font-semibold">
                <TriangleAlert className="size-4" /> Si algo sale mal
              </h2>
              <dl className="grid gap-2 text-sm">
                {mod.mistakes.map((m, i) => (
                  <div key={i}>
                    <dt className="font-medium">
                      <RichText text={m.problem} />
                    </dt>
                    <dd className="text-muted-foreground">
                      <RichText text={m.fix} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </div>
      ) : null}

      {mod.check.length ? (
        <section className="grid gap-4 rounded-xl border p-5" aria-labelledby="quiz-title">
          <h2 id="quiz-title" className="text-lg font-semibold">
            Autoevaluación
          </h2>
          {/* Las respuestas correctas no viajan al navegador: corrige el servidor. */}
          <Quiz
            roleId={role.id}
            moduleId={mod.id}
            questions={mod.check.map(({ q, options }) => ({ q, options }))}
          />
        </section>
      ) : null}

      {next ? (
        <Link
          href={`/capacitacion/${role.id}/${next.id}` as Route}
          className="text-primary w-fit font-medium hover:underline"
        >
          Siguiente módulo: {next.title} →
        </Link>
      ) : null}
    </article>
  );
}
