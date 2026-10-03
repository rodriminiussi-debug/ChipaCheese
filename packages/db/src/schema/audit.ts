import { bigserial, char, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, tstz } from "./_columns";
import { users } from "./auth";

/**
 * Historial de cambios de TODAS las tablas de negocio, escrito por triggers de Postgres
 * (ver drizzle/9999_audit_triggers.sql y src/audit.sql). El usuario se toma de
 * `current_setting('app.user_id')`, que fija `withUser()` en cada transacción.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    tableName: text().notNull(),
    recordId: text().notNull(),
    /** I = alta, U = edición, D = baja */
    action: char({ length: 1 }).notNull(),
    oldData: jsonb(),
    newData: jsonb(),
    changedBy: uuid(),
    changedAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    index("audit_record_idx").on(t.tableName, t.recordId),
    index("audit_changed_at_idx").on(t.changedAt),
  ],
);

/** Registro de exportaciones de planillas y reportes (quién, qué y cuándo; RF-36). */
export const exportLog = pgTable(
  "export_log",
  {
    id: id(),
    /** Tipo de exportación: bpm_pdf, bpm_xlsx, trace_xlsx, price_history_xlsx… */
    kind: text().notNull(),
    /** Parámetros con los que se generó (planilla, rango de fechas, filtros). */
    params: jsonb().notNull().default({}),
    userId: uuid().references(() => users.id),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [index("export_log_created_idx").on(t.createdAt)],
);

/** Consultas de trazabilidad con su duración, para el indicador "tiempo de trazabilidad" (RF-35). */
export const traceLog = pgTable(
  "trace_log",
  {
    id: id(),
    /** Lo consultado: código de lote terminado o de materia prima. */
    query: text().notNull(),
    /** Resultado: finished (lote terminado), raw (lote de proveedor), both o none. */
    result: text().notNull(),
    durationMs: integer().notNull(),
    userId: uuid().references(() => users.id),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [index("trace_log_created_idx").on(t.createdAt)],
);
