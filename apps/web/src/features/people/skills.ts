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
