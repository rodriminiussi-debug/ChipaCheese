import { summarizeTraceTimes } from "@chipa/domain";
import { and, desc, eq, gte, inArray, lte, schema, type Executor } from "@chipa/db";

/**
 * Registro de exportaciones (RF-36) y de consultas de trazabilidad (RF-35). Se escriben dentro de
 * `withUser(...)` para que la auditoría y la columna `user_id` queden con quien lo hizo.
 */

export async function recordExport(
  db: Executor,
  userId: string | null,
  kind: string,
  params: Record<string, unknown> = {},
) {
  const [row] = await db.insert(schema.exportLog).values({ kind, params, userId }).returning();
  return row!;
}

export async function listExportLog(
  db: Executor,
  opts: { kind?: string; kinds?: string[]; limit?: number } = {},
) {
  return db
    .select({
      id: schema.exportLog.id,
      kind: schema.exportLog.kind,
      params: schema.exportLog.params,
      createdAt: schema.exportLog.createdAt,
      user: schema.users.name,
    })
    .from(schema.exportLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.exportLog.userId))
    .where(
      opts.kind
        ? eq(schema.exportLog.kind, opts.kind)
        : opts.kinds
          ? inArray(schema.exportLog.kind, opts.kinds)
          : undefined,
    )
    .orderBy(desc(schema.exportLog.createdAt), desc(schema.exportLog.id))
    .limit(opts.limit ?? 100);
}

export type TraceResultKind = "finished" | "raw" | "both" | "none";

export async function recordTrace(
  db: Executor,
  userId: string | null,
  input: { query: string; result: TraceResultKind; durationMs: number },
) {
  const [row] = await db
    .insert(schema.traceLog)
    .values({
      query: input.query.slice(0, 200),
      result: input.result,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      userId,
    })
    .returning();
  return row!;
}

/**
 * Indicador "tiempo de trazabilidad" (RF-35) de las consultas hechas entre `since` y `until` (instantes; por
 * defecto los últimos `days` = 92 días, es decir un trimestre): cantidad, promedio, máximo, percentil 90 y %
 * dentro del minuto.
 */
export async function traceTimeIndicator(
  db: Executor,
  opts: { since?: Date; until?: Date; days?: number } = {},
) {
  const until = opts.until ?? new Date();
  const since = opts.since ?? new Date(until.getTime() - (opts.days ?? 92) * 86_400_000);
  const t = schema.traceLog;
  const rows = await db
    .select({ durationMs: t.durationMs, result: t.result })
    .from(t)
    .where(and(gte(t.createdAt, since), lte(t.createdAt, until)));
  return {
    all: summarizeTraceTimes(rows.map((r) => r.durationMs)),
    found: summarizeTraceTimes(rows.filter((r) => r.result !== "none").map((r) => r.durationMs)),
  };
}
