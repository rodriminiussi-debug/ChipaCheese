import { summarizeTraceTimes, type IsoDate } from "@chipa/domain";
import { and, desc, eq, gte, lt, schema, sql, type Executor } from "@chipa/db";
import { addDays } from "@chipa/domain";

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

export async function listExportLog(db: Executor, opts: { kind?: string; limit?: number } = {}) {
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
    .where(opts.kind ? eq(schema.exportLog.kind, opts.kind) : undefined)
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

/** Indicador del período `[from, to]` (días de negocio): consultas encontradas y su duración. */
export async function traceTimeIndicator(db: Executor, from: IsoDate, to: IsoDate) {
  const t = schema.traceLog;
  const rows = await db
    .select({ durationMs: t.durationMs, result: t.result })
    .from(t)
    .where(
      and(
        gte(sql`(${t.createdAt} at time zone 'America/Argentina/Buenos_Aires')::date`, sql`${from}::date`),
        lt(
          sql`(${t.createdAt} at time zone 'America/Argentina/Buenos_Aires')::date`,
          sql`${addDays(to, 1)}::date`,
        ),
      ),
    );
  return {
    all: summarizeTraceTimes(rows.map((r) => r.durationMs)),
    found: summarizeTraceTimes(rows.filter((r) => r.result !== "none").map((r) => r.durationMs)),
  };
}
