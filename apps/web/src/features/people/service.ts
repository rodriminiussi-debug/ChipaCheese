import {
  type IsoDate,
  criticalDependencies,
  suggestReplacements,
  type Replacement,
  type TaskRef,
} from "@chipa/domain";
import { and, asc, eq, inArray, lt, max, schema, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import type { SetSkillInput, ToggleAssignmentInput } from "./schemas";

/**
 * Pizarrón digital y matriz de polivalencia (RF-23). Funciones `(db: Executor, …)` testeables con `inRollback`.
 */

/** Personal de planta (operarios) y jefatura de producción: las columnas del pizarrón. */
export async function listPlantPeople(db: Executor) {
  const rows = await db.query.users.findMany({
    where: and(eq(schema.users.active, true), inArray(schema.users.role, ["operator", "production_manager"])),
    orderBy: asc(schema.users.name),
  });
  return rows.map((u) => ({ id: u.id, name: u.name, initials: u.initials, role: u.role }));
}
export type PlantPerson = Awaited<ReturnType<typeof listPlantPeople>>[number];

export async function listTasks(db: Executor): Promise<TaskRef[]> {
  const rows = await db.query.plantTasks.findMany({ orderBy: asc(schema.plantTasks.sortOrder) });
  return rows.map((t) => ({ id: t.id, name: t.name, stage: t.stage, critical: t.critical }));
}

export async function listSkills(db: Executor) {
  const rows = await db.select().from(schema.userSkills);
  return rows.map((s) => ({ userId: s.userId, taskId: s.taskId, level: s.level }));
}

/** RF-23: tarea que se quedó sin nadie por las ausencias del día, con quiénes la pueden cubrir. */
export interface AbsenceGap {
  task: TaskRef;
  /** Ausentes que estaban asignados a la tarea. */
  absent: string[];
  replacements: Replacement[];
}

/**
 * Pizarrón de un día: tareas × personas con lo asignado y el nivel de cada uno (para marcar a quien no sabe).
 * `absentIds`: personas ausentes ese día (RF-23); devuelve en `gaps` las tareas que quedaron sin cubrir por
 * esas ausencias, con los reemplazos habilitados (nivel puede/experto) de la matriz de polivalencia.
 */
export async function taskBoard(db: Executor, date: IsoDate, opts: { absentIds?: string[] } = {}) {
  const [tasks, people, skills, assignments] = await Promise.all([
    listTasks(db),
    listPlantPeople(db),
    listSkills(db),
    db.query.taskAssignments.findMany({ where: eq(schema.taskAssignments.date, date) }),
  ]);
  const absentIds = (opts.absentIds ?? []).filter((id) => people.some((p) => p.id === id));
  const board = assignments.map((a) => ({ taskId: a.taskId, userId: a.userId }));
  const busyUserIds = [...new Set(board.filter((a) => !absentIds.includes(a.userId)).map((a) => a.userId))];
  const gaps: AbsenceGap[] = [];
  for (const task of tasks) {
    const assignedHere = board.filter((a) => a.taskId === task.id).map((a) => a.userId);
    const absentHere = assignedHere.filter((u) => absentIds.includes(u));
    // Solo las tareas que perdieron a alguien por una ausencia y quedaron sin nadie.
    if (!absentHere.length || absentHere.length < assignedHere.length) continue;
    gaps.push({
      task,
      absent: absentHere,
      replacements: suggestReplacements({
        taskId: task.id,
        skills,
        absentUserIds: absentIds,
        assignedUserIds: assignedHere,
        busyUserIds,
      }),
    });
  }
  return {
    date,
    tasks,
    people,
    skills,
    assignments: board,
    absentIds,
    gaps,
    alerts: criticalDependencies(tasks, skills),
  };
}
export type TaskBoard = Awaited<ReturnType<typeof taskBoard>>;

/** Matriz de polivalencia con la alerta de dependencias críticas. */
export async function skillMatrix(db: Executor) {
  const [tasks, people, skills] = await Promise.all([listTasks(db), listPlantPeople(db), listSkills(db)]);
  return { tasks, people, skills, alerts: criticalDependencies(tasks, skills) };
}
export type SkillMatrix = Awaited<ReturnType<typeof skillMatrix>>;

/** Asigna o desasigna una persona a una tarea del día. */
export async function toggleAssignment(db: Executor, input: ToggleAssignmentInput) {
  if (input.assigned) {
    const [task, user] = await Promise.all([
      db.query.plantTasks.findFirst({ where: eq(schema.plantTasks.id, input.taskId) }),
      db.query.users.findFirst({ where: eq(schema.users.id, input.userId) }),
    ]);
    if (!task) throw new UserError("La tarea no existe.");
    if (!user?.active) throw new UserError("La persona no existe o está inactiva.");
    await db
      .insert(schema.taskAssignments)
      .values({ date: input.date, taskId: input.taskId, userId: input.userId })
      .onConflictDoNothing();
    return;
  }
  await db
    .delete(schema.taskAssignments)
    .where(
      and(
        eq(schema.taskAssignments.date, input.date),
        eq(schema.taskAssignments.taskId, input.taskId),
        eq(schema.taskAssignments.userId, input.userId),
      ),
    );
}

/**
 * Copia al día `date` la asignación del último día anterior que tenga una (así el lunes copia el viernes).
 * No pisa lo ya asignado en `date`.
 */
export async function copyPreviousAssignments(db: Executor, date: IsoDate) {
  const [{ from }] = await db
    .select({ from: max(schema.taskAssignments.date) })
    .from(schema.taskAssignments)
    .where(lt(schema.taskAssignments.date, date));
  if (!from) throw new UserError("No hay una asignación anterior para copiar.");
  const prev = await db.query.taskAssignments.findMany({ where: eq(schema.taskAssignments.date, from) });
  const inserted = await db
    .insert(schema.taskAssignments)
    .values(prev.map((a) => ({ date, taskId: a.taskId, userId: a.userId, notes: a.notes })))
    .onConflictDoNothing()
    .returning({ id: schema.taskAssignments.id });
  return { from, copied: inserted.length };
}

/** Define (o borra, con `null`) el nivel de una persona en una tarea. */
export async function setSkill(db: Executor, input: SetSkillInput) {
  if (input.level == null) {
    await db
      .delete(schema.userSkills)
      .where(and(eq(schema.userSkills.userId, input.userId), eq(schema.userSkills.taskId, input.taskId)));
    return;
  }
  await db
    .insert(schema.userSkills)
    .values({ userId: input.userId, taskId: input.taskId, level: input.level })
    .onConflictDoUpdate({
      target: [schema.userSkills.userId, schema.userSkills.taskId],
      set: { level: input.level },
    });
}

/** "Mis tareas de hoy" (modo planta): lo asignado a la persona, con quién comparte cada tarea. */
export async function myTasks(db: Executor, userId: string, date: IsoDate) {
  const mine = await db.query.taskAssignments.findMany({
    where: and(eq(schema.taskAssignments.date, date), eq(schema.taskAssignments.userId, userId)),
    with: { task: true },
  });
  if (!mine.length) return [];
  const mates = await db.query.taskAssignments.findMany({
    where: and(
      eq(schema.taskAssignments.date, date),
      inArray(
        schema.taskAssignments.taskId,
        mine.map((m) => m.taskId),
      ),
    ),
    with: { user: true },
  });
  return mine
    .map((m) => ({
      taskId: m.taskId,
      name: m.task.name,
      stage: m.task.stage,
      critical: m.task.critical,
      sortOrder: m.task.sortOrder,
      notes: m.notes,
      with: mates.filter((x) => x.taskId === m.taskId && x.userId !== userId).map((x) => x.user.initials),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
