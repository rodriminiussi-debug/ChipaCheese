"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { formatDateAR } from "@chipa/domain";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { copyAssignmentsAction, toggleAssignmentAction } from "../actions";
import { STAGE_ORDER, TASK_STAGE } from "../labels";
import type { TaskBoard as TaskBoardData } from "../service";

const key = (taskId: string, userId: string) => `${taskId}:${userId}`;

/**
 * Pizarrón digital (RF-23): grilla tarea × persona del día, agrupada por etapa. Cada casilla se guarda
 * al tocarla. Se marca en ámbar a quien está asignado sin tener el nivel "puede" en esa tarea.
 */
export function TaskBoard({
  board,
  canWrite,
}: {
  board: Pick<TaskBoardData, "date" | "tasks" | "people" | "skills" | "assignments">;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [assigned, setAssigned] = useState(
    () => new Set(board.assignments.map((a) => key(a.taskId, a.userId))),
  );
  const toggle = useAction(toggleAssignmentAction);
  const copy = useAction(copyAssignmentsAction, {
    success: (d) => `Se copiaron ${d.copied} asignaciones del ${formatDateAR(d.from)}`,
    onSuccess: () => router.refresh(),
  });
  const skill = new Map(board.skills.map((s) => [key(s.taskId, s.userId), s.level]));
  const able = (taskId: string, userId: string) =>
    ["able", "expert"].includes(skill.get(key(taskId, userId)) ?? "");

  async function onToggle(taskId: string, userId: string, value: boolean) {
    const k = key(taskId, userId);
    const next = new Set(assigned);
    if (value) next.add(k);
    else next.delete(k);
    setAssigned(next);
    const res = await toggle.run({ date: board.date, taskId, userId, assigned: value });
    if (!res.ok) setAssigned(assigned); // revertir
  }

  return (
    <div className="grid gap-4">
      {canWrite ? (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={copy.pending}
            onClick={() => copy.run({ date: board.date })}
          >
            <Copy /> Copiar asignación del día anterior
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-56">Tarea</TableHead>
              {board.people.map((p) => (
                <TableHead key={p.id} className="text-center" title={p.name}>
                  {p.initials}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {STAGE_ORDER.map((stage) => {
              const tasks = board.tasks.filter((t) => t.stage === stage);
              if (!tasks.length) return null;
              return [
                <TableRow key={stage} className="bg-muted/50 hover:bg-muted/50">
                  <TableCell colSpan={board.people.length + 1} className="text-sm font-semibold">
                    {TASK_STAGE[stage]}
                  </TableCell>
                </TableRow>,
                ...tasks.map((t) => {
                  const count = board.people.filter((p) => assigned.has(key(t.id, p.id))).length;
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <span className="font-medium">{t.name}</span>{" "}
                        {t.critical ? <StatusBadge tone="warn">Crítica</StatusBadge> : null}
                        {count === 0 ? (
                          <span className="text-muted-foreground ml-1 text-xs">sin asignar</span>
                        ) : null}
                      </TableCell>
                      {board.people.map((p) => {
                        const on = assigned.has(key(t.id, p.id));
                        const ok = able(t.id, p.id);
                        return (
                          <TableCell key={p.id} className="text-center">
                            <Checkbox
                              checked={on}
                              disabled={!canWrite}
                              aria-label={`Asignar ${p.initials} a ${t.name}`}
                              title={ok ? undefined : `${p.initials} no tiene el nivel “puede” en esta tarea`}
                              className={cn(
                                "size-6",
                                on && !ok && "border-amber-500 data-checked:bg-amber-500",
                                !on && !ok && "opacity-40",
                              )}
                              onCheckedChange={(v) => onToggle(t.id, p.id, v === true)}
                            />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                }),
              ];
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-muted-foreground text-xs">
        Las casillas en ámbar son personas asignadas sin el nivel “puede” en esa tarea (ver matriz de
        polivalencia).
      </p>
    </div>
  );
}
