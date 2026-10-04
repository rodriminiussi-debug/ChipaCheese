import { PageHeader } from "@/components/app/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getTeamProgress } from "@/features/training/service";
import { ProgressBar } from "@/features/training/components/progress-bar";
import { formatDateTimeAR } from "@/lib/dates";

export const metadata = { title: "Avance del equipo" };

export default async function TeamProgressPage() {
  await requirePermission(["admin", "people:read"]);
  const team = await getTeamProgress(db);
  return (
    <>
      <PageHeader
        title="Avance del equipo"
        description="Cada persona contra los módulos de su rol. Un módulo queda aprobado cuando responde bien toda la autoevaluación."
      />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Persona</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead className="min-w-48">Avance</TableHead>
              <TableHead>Módulos aprobados</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {team.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">
                  {u.name} <span className="text-muted-foreground text-xs">{u.initials}</span>
                </TableCell>
                <TableCell>{u.roleTitle}</TableCell>
                <TableCell>
                  <ProgressBar done={u.done} total={u.total} />
                </TableCell>
                <TableCell className="text-xs">
                  <ul className="grid gap-0.5">
                    {u.modules
                      .filter((m) => m.completedAt)
                      .map((m) => (
                        <li key={m.id}>
                          {m.title}{" "}
                          <span className="text-muted-foreground">· {formatDateTimeAR(m.completedAt!)}</span>
                        </li>
                      ))}
                  </ul>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
