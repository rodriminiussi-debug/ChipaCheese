import { and, asc, eq, schema, sql, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import type { Role } from "@/lib/rbac";
import { findModule, moduleKey, ROLE_TO_TRAINING, TRAINING } from "./content";

export interface QuizResult {
  score: number;
  total: number;
  passed: boolean;
  results: { correct: boolean; answer: number; explain: string }[];
}

/** Corrige la autoevaluación contra el guion (nunca contra lo que diga el cliente) y guarda el avance. */
export async function submitQuiz(
  db: Executor,
  userId: string,
  input: { roleId: string; moduleId: string; answers: number[] },
): Promise<QuizResult> {
  const mod = findModule(input.roleId, input.moduleId);
  if (!mod) throw new UserError("El módulo no existe.");
  if (!mod.check.length) throw new UserError("Este módulo no tiene autoevaluación.");
  if (input.answers.length !== mod.check.length) throw new UserError("Respondé todas las preguntas.");

  const results = mod.check.map((q, i) => ({
    correct: input.answers[i] === q.answer,
    answer: q.answer,
    explain: q.explain,
  }));
  const score = results.filter((r) => r.correct).length;
  const total = mod.check.length;
  const passed = score === total;
  const key = moduleKey(input.roleId, input.moduleId);
  const now = new Date();

  await db
    .insert(schema.trainingProgress)
    .values({ userId, moduleKey: key, score, total, completedAt: passed ? now : null, lastAttemptAt: now })
    .onConflictDoUpdate({
      target: [schema.trainingProgress.userId, schema.trainingProgress.moduleKey],
      set: {
        score,
        total,
        attempts: sql`${schema.trainingProgress.attempts} + 1`,
        lastAttemptAt: now,
        // Una vez aprobado, queda aprobado aunque un repaso posterior falle.
        completedAt: sql`coalesce(${schema.trainingProgress.completedAt}, excluded.completed_at)`,
      },
    });
  return { score, total, passed, results };
}

/** Avance del usuario: moduleKey → estado. */
export async function getUserProgress(db: Executor, userId: string) {
  const rows = await db
    .select()
    .from(schema.trainingProgress)
    .where(eq(schema.trainingProgress.userId, userId));
  return Object.fromEntries(rows.map((r) => [r.moduleKey, r]));
}
export type UserProgress = Awaited<ReturnType<typeof getUserProgress>>;

export function roleCompletion(progress: UserProgress, roleId: string) {
  const role = TRAINING.roles.find((r) => r.id === roleId);
  const total = role?.modules.length ?? 0;
  const done = role?.modules.filter((m) => progress[moduleKey(roleId, m.id)]?.completedAt).length ?? 0;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/**
 * Avance del equipo: cada persona contra los módulos de SU rol (Fase 2 del relevamiento:
 * "se capacita a cada usuario en su módulo").
 */
export async function getTeamProgress(db: Executor) {
  const [users, rows] = await Promise.all([
    db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        initials: schema.users.initials,
        role: schema.users.role,
      })
      .from(schema.users)
      .where(and(eq(schema.users.active, true)))
      .orderBy(asc(schema.users.name)),
    db.select().from(schema.trainingProgress),
  ]);
  return users.map((u) => {
    const roleId = ROLE_TO_TRAINING[u.role as Role];
    const role = TRAINING.roles.find((r) => r.id === roleId);
    const mine = rows.filter((r) => r.userId === u.id);
    const modules = (role?.modules ?? []).map((m) => {
      const p = mine.find((r) => r.moduleKey === moduleKey(roleId, m.id));
      return {
        id: m.id,
        title: m.title,
        completedAt: p?.completedAt ?? null,
        score: p?.score ?? null,
        total: p?.total ?? m.check.length,
        attempts: p?.attempts ?? 0,
      };
    });
    const done = modules.filter((m) => m.completedAt).length;
    return { ...u, roleId, roleTitle: role?.title ?? roleId, modules, done, total: modules.length };
  });
}
