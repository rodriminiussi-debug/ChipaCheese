import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, BookOpen, ScanSearch, Users } from "lucide-react";
import { BrandMark } from "@/components/brand/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { can } from "@/lib/rbac";
import { journeyShots, ROLE_TO_TRAINING, TRAINING } from "@/features/training/content";
import { getUserProgress, roleCompletion } from "@/features/training/service";
import { JourneyAnimation } from "@/features/training/components/journey-animation";
import { ProgressBar } from "@/features/training/components/progress-bar";

export const metadata = { title: "Capacitación" };

export default async function TrainingHome() {
  const user = await requirePermission("training:read");
  const progress = await getUserProgress(db, user.id);
  const myRoleId = ROLE_TO_TRAINING[user.role];
  const mine = TRAINING.roles.find((r) => r.id === myRoleId);
  const others = TRAINING.roles.filter((r) => r.id !== myRoleId);
  const canSeeTeam = can(user.role, ["admin", "people:read"]);

  return (
    <div className="grid gap-10">
      <header className="flex flex-wrap items-center gap-4">
        <BrandMark className="size-16" />
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">Capacitación</h1>
          <p className="text-muted-foreground mt-1 max-w-prose">
            Cómo funciona el sistema, paso a paso y con las pantallas reales. Empezá por tu rol; los demás
            también están abiertos para que puedas aprender las tareas de un compañero.
          </p>
        </div>
      </header>

      <section className="grid gap-4" aria-labelledby="recorrido-title">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="recorrido-title" className="text-xl font-semibold">
              El recorrido de una bolsa
            </h2>
            <p className="text-muted-foreground text-sm">
              Del pedido por WhatsApp al tablero: qué pasa en cada etapa y quién lo carga.
            </p>
          </div>
          <Link
            href={"/capacitacion/recorrido" as Route}
            className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline"
          >
            <ScanSearch className="size-4" /> Ver también la trazabilidad de un lote
          </Link>
        </div>
        <JourneyAnimation shots={journeyShots()} />
      </section>

      {mine ? (
        <section className="grid gap-4" aria-labelledby="mine-title">
          <h2 id="mine-title" className="text-xl font-semibold">
            Tu capacitación
          </h2>
          <Card className="border-primary/40">
            <CardHeader>
              <CardTitle className="text-lg">{mine.title}</CardTitle>
              <CardDescription>
                {mine.device}
                {mine.goal ? ` · ${mine.goal}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ProgressBar {...roleCompletion(progress, mine.id)} className="max-w-sm" />
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {mine.modules.map((m) => {
                  const p = progress[`${mine.id}/${m.id}`];
                  return (
                    <li key={m.id}>
                      <Link
                        href={`/capacitacion/${mine.id}/${m.id}` as Route}
                        className="hover:bg-muted flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm"
                      >
                        <span className="min-w-0">{m.title}</span>
                        {p?.completedAt ? (
                          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                            Aprobado
                          </span>
                        ) : (
                          <ArrowRight className="text-muted-foreground size-4 shrink-0" />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="grid gap-4" aria-labelledby="roles-title">
        <h2 id="roles-title" className="text-xl font-semibold">
          Otros roles
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {others.map((r) => (
            <li key={r.id}>
              <Link
                href={`/capacitacion/${r.id}` as Route}
                className="hover:bg-muted grid h-full gap-1 rounded-xl border p-4"
              >
                <span className="font-medium">{r.title}</span>
                <span className="text-muted-foreground text-sm">
                  {r.modules.length} módulos · {r.device}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <nav className="flex flex-wrap gap-3" aria-label="Más material">
        <Link
          href={"/capacitacion/glosario" as Route}
          className="hover:bg-muted inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium"
        >
          <BookOpen className="size-4" /> Glosario
        </Link>
        {canSeeTeam ? (
          <Link
            href={"/capacitacion/equipo" as Route}
            className="hover:bg-muted inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium"
          >
            <Users className="size-4" /> Avance del equipo
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
