import { bigserial, char, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { tstz } from "./_columns";

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
