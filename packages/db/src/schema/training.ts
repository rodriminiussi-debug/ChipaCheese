import { relations } from "drizzle-orm";
import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./_columns";
import { users } from "./auth";

/**
 * Avance de capacitación por usuario y módulo (contenido en apps/web/src/features/training/content).
 * `moduleKey` = "<rol>/<módulo>", p. ej. "operario/pesadas".
 */
export const trainingProgress = pgTable(
  "training_progress",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    moduleKey: text().notNull(),
    /** Respuestas correctas del último intento y total de preguntas. */
    score: integer().notNull(),
    total: integer().notNull(),
    attempts: integer().notNull().default(1),
    /** Se completa al aprobar la autoevaluación (todas correctas). */
    completedAt: tstz(),
    lastAttemptAt: tstz().notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("training_progress_uq").on(t.userId, t.moduleKey),
    index("training_progress_user_idx").on(t.userId),
  ],
);

export const trainingProgressRelations = relations(trainingProgress, ({ one }) => ({
  user: one(users, { fields: [trainingProgress.userId], references: [users.id] }),
}));
