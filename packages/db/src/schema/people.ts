import { relations } from "drizzle-orm";
import { boolean, index, integer, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { day, id, timestamps } from "./_columns";
import { skillLevelEnum, taskStageEnum } from "./enums";
import { users } from "./auth";

/** Catálogo de tareas de planta (la matriz del pizarrón). RF-23. */
export const plantTasks = pgTable("plant_tasks", {
  id: id(),
  stage: taskStageEnum().notNull(),
  name: text().notNull(),
  /** Tarea crítica: debe tener al menos un reemplazo capacitado. */
  critical: boolean().notNull().default(false),
  sortOrder: integer().notNull().default(0),
  ...timestamps(),
});

/** Matriz de polivalencia: quién sabe hacer qué. */
export const userSkills = pgTable(
  "user_skills",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: uuid()
      .notNull()
      .references(() => plantTasks.id, { onDelete: "cascade" }),
    level: skillLevelEnum().notNull(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.taskId] })],
);

/** Pizarrón digital: asignación de tareas por día. */
export const taskAssignments = pgTable(
  "task_assignments",
  {
    id: id(),
    date: day().notNull(),
    taskId: uuid()
      .notNull()
      .references(() => plantTasks.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    notes: text(),
    ...timestamps(),
  },
  (t) => [
    index("task_assignments_date_idx").on(t.date),
    uniqueIndex("task_assignments_uq").on(t.date, t.taskId, t.userId),
  ],
);

export const plantTasksRelations = relations(plantTasks, ({ many }) => ({
  skills: many(userSkills),
  assignments: many(taskAssignments),
}));
export const userSkillsRelations = relations(userSkills, ({ one }) => ({
  user: one(users, { fields: [userSkills.userId], references: [users.id] }),
  task: one(plantTasks, { fields: [userSkills.taskId], references: [plantTasks.id] }),
}));
export const taskAssignmentsRelations = relations(taskAssignments, ({ one }) => ({
  user: one(users, { fields: [taskAssignments.userId], references: [users.id] }),
  task: one(plantTasks, { fields: [taskAssignments.taskId], references: [plantTasks.id] }),
}));
