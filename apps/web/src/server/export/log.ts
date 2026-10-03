import "server-only";
import { withUser } from "@chipa/db";
import { db } from "@/server/db";
import { recordExport, recordTrace, type TraceResultKind } from "@/features/admin/logs";

/**
 * RF-36: deja registrado quién generó una exportación (PDF/Excel), de qué tipo y con qué parámetros.
 * Se llama desde los Route Handlers de descarga una vez generado el archivo.
 */
export async function logExport(userId: string, kind: string, params: Record<string, unknown> = {}) {
  await withUser(db, userId, (tx) => recordExport(tx, userId, kind, params));
}

/** RF-35: registra una consulta de trazabilidad con su duración, para el indicador trimestral. */
export async function logTrace(
  userId: string,
  input: { query: string; result: TraceResultKind; durationMs: number },
) {
  await withUser(db, userId, (tx) => recordTrace(tx, userId, input));
}
