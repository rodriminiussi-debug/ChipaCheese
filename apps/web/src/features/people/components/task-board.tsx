"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, UserMinus, UserPlus } from "lucide-react";
import { formatDateAR, suggestReplacements } from "@chipa/domain";
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
  board: Pick<TaskBoardData, "date" | "tasks" | "people" | "skills" | "assignments" | "absentIds">;
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
  const absent = new Set(board.absentIds);
  const [open, setOpen] = useState<Set<string>>(
    () =>
      // Abiertas de entrada las tareas que quedaron sin nadie por una ausencia.
      new Set(
        board.tasks
          .filter((t) => {
            const here = board.assignments.filter((a) => a.taskId === t.id).map((a) => a.userId);
            return here.length > 0 && here.every((u) => absent.has(u));
          })
          .map((t) => t.id),
      ),
  );
  const toggleAbsent = (userId: string) => {
    const next = new Set(absent);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    const qs = new URLSearchParams({ fecha: board.date });
    if (next.size) qs.set("ausentes", [...next].join(","));
    router.replace(`/personas?${qs.toString()}`);
  };
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
                  <span className={cn(absent.has(p.id) && "text-muted-foreground line-through")}>
                    {p.initials}
                  </span>
                  <Button
                    type="button"
                    variant={absent.has(p.id) ? "secondary" : "ghost"}
                    size="icon-xs"
                    className="ml-1 align-middle"
                    aria-pressed={absent.has(p.id)}
                    aria-label={`${absent.has(p.id) ? "Quitar ausencia de" : "Marcar ausente a"} ${p.initials}`}
                    title={absent.has(p.id) ? `${p.name} está ausente` : `Marcar ausente a ${p.name}`}
                    onClick={() => toggleAbsent(p.id)}
                  >
                    <UserMinus />
                  </Button>
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
                  const assignedHere = board.people.filter((p) => assigned.has(key(t.id, p.id)));
                  const count = assignedHere.filter((p) => !absent.has(p.id)).length;
                  const absentHere = assignedHere.filter((p) => absent.has(p.id));
                  const busy = [...assigned].map((k) => k.split(":")[1]!).filter((u) => !absent.has(u));
                  const replacements =
                    count === 0 && open.has(t.id)
                      ? suggestReplacements({
                          taskId: t.id,
                          skills: board.skills,
                          absentUserIds: [...absent],
                          assignedUserIds: assignedHere.map((p) => p.id),
                          busyUserIds: busy,
                        })
                      : [];
                  return (
                    <TableRow key={t.id} data-uncovered={(count === 0 && absentHere.length > 0) || undefined}>
                      <TableCell>
                        <span className="font-medium">{t.name}</span>{" "}
                        {t.critical ? <StatusBadge tone="warn">Crítica</StatusBadge> : null}
                        {count === 0 ? (
                          <span className="text-muted-foreground ml-1 text-xs">
                            {absentHere.length
                              ? `sin cubrir: ${absentHere.map((p) => p.initials).join(", ")} ausente`
                              : "sin asignar"}
                          </span>
                        ) : null}
                        {count === 0 && canWrite ? (
                          <div className="mt-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              aria-expanded={open.has(t.id)}
                              onClick={() =>
                                setOpen((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(t.id)) next.delete(t.id);
                                  else next.add(t.id);
                                  return next;
                                })
                              }
                            >
                              <UserPlus /> {open.has(t.id) ? "Ocultar reemplazos" : "Sugerir reemplazo"}
                            </Button>
                            {open.has(t.id) ? (
                              <ul
                                className="mt-1 flex flex-wrap gap-1"
                                aria-label={`Reemplazos habilitados para ${t.name}`}
                              >
                                {replacements.length === 0 ? (
                                  <li className="text-muted-foreground text-xs">
                                    No hay nadie más habilitado (nivel puede o experto) disponible.
                                  </li>
                                ) : (
                                  replacements.map((r) => {
                                    const person = board.people.find((p) => p.id === r.userId);
                                    if (!person) return null;
                                    return (
                                      <li key={r.userId}>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="xs"
                                          aria-label={`Asignar a ${person.initials} como reemplazo en ${t.name}`}
                                          onClick={() => onToggle(t.id, r.userId, true)}
                                        >
                                          {person.initials} · {r.level === "expert" ? "experto" : "puede"}
                                          {r.busy ? " · ya tiene otra tarea" : ""}
                                        </Button>
                                      </li>
                                    );
                                  })
                                )}
                              </ul>
                            ) : null}
                          </div>
                        ) : null}
                      </TableCell>
                      {board.people.map((p) => {
                        const on = assigned.has(key(t.id, p.id));
                        const ok = able(t.id, p.id);
                        return (
                          <TableCell key={p.id} className="text-center">
                            <Checkbox
                              checked={on}
                              disabled={!canWrite || (absent.has(p.id) && !on)}
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
