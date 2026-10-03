"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/app/status-badge";
import { NativeSelect } from "@/components/app/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { setSkillAction } from "../actions";
import { SKILL_LEVELS } from "../schemas";
import { SKILL_LEVEL, STAGE_ORDER, TASK_STAGE } from "../labels";
import type { SkillMatrix } from "../service";

const key = (taskId: string, userId: string) => `${taskId}:${userId}`;
const LEVEL_TONE: Record<string, string> = {
  learning: "border-sky-400 bg-sky-50 dark:bg-sky-950/40",
  able: "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40",
  expert: "border-emerald-600 bg-emerald-100 font-semibold dark:bg-emerald-900/40",
};

/** Matriz de polivalencia (RF-23): quién sabe hacer qué (aprendiendo / puede / experto). Editable. */
export function SkillsMatrix({
  matrix,
  canWrite,
}: {
  matrix: Pick<SkillMatrix, "tasks" | "people" | "skills">;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [levels, setLevels] = useState<Map<string, string>>(
    () => new Map(matrix.skills.map((s) => [key(s.taskId, s.userId), s.level])),
  );
  const save = useAction(setSkillAction, { onSuccess: () => router.refresh() });

  async function change(taskId: string, userId: string, value: string) {
    const prev = levels;
    const next = new Map(levels);
    if (value) next.set(key(taskId, userId), value);
    else next.delete(key(taskId, userId));
    setLevels(next);
    const res = await save.run({
      taskId,
      userId,
      level: value ? (value as (typeof SKILL_LEVELS)[number]) : null,
    });
    if (!res.ok) setLevels(prev);
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56">Tarea</TableHead>
            {matrix.people.map((p) => (
              <TableHead key={p.id} className="text-center" title={p.name}>
                {p.initials}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {STAGE_ORDER.map((stage) => {
            const tasks = matrix.tasks.filter((t) => t.stage === stage);
            if (!tasks.length) return null;
            return [
              <TableRow key={stage} className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={matrix.people.length + 1} className="text-sm font-semibold">
                  {TASK_STAGE[stage]}
                </TableCell>
              </TableRow>,
              ...tasks.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <span className="font-medium">{t.name}</span>{" "}
                    {t.critical ? <StatusBadge tone="warn">Crítica</StatusBadge> : null}
                  </TableCell>
                  {matrix.people.map((p) => {
                    const level = levels.get(key(t.id, p.id)) ?? "";
                    return (
                      <TableCell key={p.id} className="p-1">
                        <NativeSelect
                          aria-label={`Nivel de ${p.initials} en ${t.name}`}
                          className={cn("h-8 min-w-28 text-xs", level && LEVEL_TONE[level])}
                          value={level}
                          disabled={!canWrite}
                          onChange={(e) => change(t.id, p.id, e.target.value)}
                        >
                          <option value="">—</option>
                          {SKILL_LEVELS.map((l) => (
                            <option key={l} value={l}>
                              {SKILL_LEVEL[l]}
                            </option>
                          ))}
                        </NativeSelect>
                      </TableCell>
                    );
                  })}
                </TableRow>
              )),
            ];
          })}
        </TableBody>
      </Table>
    </div>
  );
}
