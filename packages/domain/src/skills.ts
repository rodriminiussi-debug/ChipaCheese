/**
 * Dependencia crítica (RF-23): una tarea marcada `critical` con menos de `minHolders` personas
 * que puedan hacerla (nivel "puede" o "experto") es un riesgo: si esa persona falta, se frena la planta.
 * Puro y sin I/O; ver skills.test.ts.
 */
export const ABLE_LEVELS = ["able", "expert"] as const;
export const MIN_HOLDERS = 2;

export interface TaskRef {
  id: string;
  name: string;
  stage: string;
  critical: boolean;
}
export interface SkillRef {
  userId: string;
  taskId: string;
  level: string;
}
export interface CriticalAlert {
  task: TaskRef;
  /** Personas que hoy pueden hacer la tarea. */
  holders: string[];
}

export function criticalDependencies(
  tasks: TaskRef[],
  skills: SkillRef[],
  minHolders: number = MIN_HOLDERS,
): CriticalAlert[] {
  return tasks
    .filter((t) => t.critical)
    .map((task) => ({
      task,
      holders: skills
        .filter((s) => s.taskId === task.id && (ABLE_LEVELS as readonly string[]).includes(s.level))
        .map((s) => s.userId),
    }))
    .filter((a) => a.holders.length < minHolders);
}

export interface Replacement {
  userId: string;
  /** Nivel en la tarea: "expert" primero. */
  level: "able" | "expert";
  /** Ya tiene otra tarea asignada ese día. */
  busy: boolean;
}

/**
 * RF-23: reemplazos habilitados para una tarea: personas con nivel "puede" o "experto" en la matriz de
 * polivalencia que no están ausentes ni asignadas ya a esa tarea. Primero los expertos, después los que
 * no tienen otra tarea ese día; a igualdad, por id para que el orden sea estable.
 */
export function suggestReplacements(input: {
  taskId: string;
  skills: SkillRef[];
  absentUserIds: readonly string[];
  /** Personas ya asignadas a esta tarea ese día. */
  assignedUserIds: readonly string[];
  /** Personas con alguna tarea asignada ese día (cualquiera). */
  busyUserIds: readonly string[];
}): Replacement[] {
  const out: Replacement[] = [];
  for (const s of input.skills) {
    if (s.taskId !== input.taskId) continue;
    if (!(ABLE_LEVELS as readonly string[]).includes(s.level)) continue;
    if (input.absentUserIds.includes(s.userId) || input.assignedUserIds.includes(s.userId)) continue;
    out.push({
      userId: s.userId,
      level: s.level as Replacement["level"],
      busy: input.busyUserIds.includes(s.userId),
    });
  }
  return out.sort(
    (a, b) =>
      Number(b.level === "expert") - Number(a.level === "expert") ||
      Number(a.busy) - Number(b.busy) ||
      a.userId.localeCompare(b.userId),
  );
}
