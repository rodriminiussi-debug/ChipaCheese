import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./_columns";
import { roleEnum } from "./enums";

/**
 * Personas que usan el sistema. Los operarios de planta entran con usuario + PIN en la tablet;
 * el resto con email + contraseña.
 */
export const users = pgTable(
  "users",
  {
    id: id(),
    name: text().notNull(),
    /** Iniciales usadas en las planillas BPM (J.T., S.G., A.F.…). */
    initials: text().notNull(),
    username: text().notNull(),
    email: text(),
    passwordHash: text(),
    pinHash: text(),
    role: roleEnum().notNull(),
    active: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("users_username_uq").on(t.username), uniqueIndex("users_email_uq").on(t.email)],
);

/** Sesiones server-side. `id` es el SHA-256 del token que viaja en la cookie. */
export const sessions = pgTable(
  "sessions",
  {
    id: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: tstz().notNull(),
    userAgent: text(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const usersRelations = relations(users, ({ many }) => ({ sessions: many(sessions) }));
export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));
