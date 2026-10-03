import Link from "next/link";
import { addDays, assertIsoDate, formatDateAR, isoWeekday, type IsoDate } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { can } from "@/lib/rbac";
import { todayAR, WEEKDAY_LABELS } from "@/lib/dates";
import { CriticalAlerts } from "@/features/people/components/critical-alerts";
import { SkillsMatrix } from "@/features/people/components/skills-matrix";
import { TaskBoard } from "@/features/people/components/task-board";
import { skillMatrix, taskBoard } from "@/features/people/service";

export const metadata = { title: "Personas y tareas" };

function validDate(v: unknown): IsoDate | null {
  if (typeof v !== "string") return null;
  try {
    assertIsoDate(v);
    return v;
  } catch {
    return null;
  }
}

export default async function PeoplePage(props: PageProps<"/personas">) {
  const user = await requirePermission("people:read");
  const sp = await props.searchParams;
  const date = validDate(sp.fecha) ?? todayAR();
  const view = sp.vista === "matriz" ? "matriz" : "pizarron";
  const canWrite = can(user.role, "people:write");
  const [board, matrix] = await Promise.all([taskBoard(db, date), skillMatrix(db)]);

  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`;

  return (
    <>
      <PageHeader
        title="Personas y tareas"
        description="RF-23 · Pizarrón digital de tareas del día y matriz de polivalencia (quién sabe hacer qué y quién reemplaza a quién)."
      />
      <div className="grid gap-6">
        <CriticalAlerts alerts={board.alerts} people={board.people} />

        <nav className="flex gap-1" aria-label="Vista">
          <Link
            href={`/personas?fecha=${date}`}
            className={tabClass(view === "pizarron")}
            aria-current={view === "pizarron" ? "page" : undefined}
          >
            Pizarrón del día
          </Link>
          <Link
            href={`/personas?vista=matriz&fecha=${date}`}
            className={tabClass(view === "matriz")}
            aria-current={view === "matriz" ? "page" : undefined}
          >
            Matriz de polivalencia
          </Link>
        </nav>

        {view === "pizarron" ? (
          <section aria-labelledby="pizarron" className="grid gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <h2 id="pizarron" className="text-lg font-semibold">
                {WEEKDAY_LABELS[isoWeekday(date)]} {formatDateAR(date)}
              </h2>
              <form className="flex items-end gap-2" aria-label="Elegir día">
                <Input type="date" name="fecha" defaultValue={date} className="w-44" aria-label="Fecha" />
                <Button type="submit" variant="outline">
                  Ir
                </Button>
              </form>
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/personas?fecha=${addDays(date, -1)}`}>← Día anterior</Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/personas?fecha=${addDays(date, 1)}`}>Día siguiente →</Link>
              </Button>
            </div>
            <TaskBoard key={`${date}-${board.assignments.length}`} board={board} canWrite={canWrite} />
          </section>
        ) : (
          <section aria-labelledby="matriz" className="grid gap-4">
            <h2 id="matriz" className="text-lg font-semibold">
              Matriz de polivalencia
            </h2>
            <SkillsMatrix key={matrix.skills.length} matrix={matrix} canWrite={canWrite} />
          </section>
        )}
      </div>
    </>
  );
}
