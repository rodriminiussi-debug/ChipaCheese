import { and, asc, desc, eq, ne, schema, sql, type Executor } from "@chipa/db";
import { hashSecret } from "@/server/auth/password";
import { UserError } from "@/server/errors";
import type { UserData } from "./schemas";

export function listUsers(db: Executor) {
  return db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      initials: schema.users.initials,
      username: schema.users.username,
      email: schema.users.email,
      role: schema.users.role,
      active: schema.users.active,
      hasPin: sql<boolean>`${schema.users.pinHash} is not null`,
    })
    .from(schema.users)
    .orderBy(desc(schema.users.active), asc(schema.users.name));
}

export function getUser(db: Executor, id: string) {
  return db.query.users.findFirst({
    where: eq(schema.users.id, id),
    columns: { passwordHash: false, pinHash: false },
  });
}

async function assertUnique(db: Executor, data: UserData, exceptId?: string) {
  const dupUser = await db.query.users.findFirst({
    where: and(
      eq(schema.users.username, data.username),
      exceptId ? ne(schema.users.id, exceptId) : undefined,
    ),
  });
  if (dupUser) throw new UserError("Ese nombre de usuario ya existe.", { username: ["Ya existe"] });
  if (data.email) {
    const dupEmail = await db.query.users.findFirst({
      where: and(eq(schema.users.email, data.email), exceptId ? ne(schema.users.id, exceptId) : undefined),
    });
    if (dupEmail) throw new UserError("Ese email ya está en uso.", { email: ["Ya existe"] });
  }
}

export async function createUser(db: Executor, data: UserData) {
  await assertUnique(db, data);
  if (!data.password && !data.pin)
    throw new UserError("Definí una contraseña o un PIN.", { password: ["Requerido si no hay PIN"] });
  const [row] = await db
    .insert(schema.users)
    .values({
      name: data.name,
      initials: data.initials,
      username: data.username,
      email: data.email,
      role: data.role,
      active: data.active,
      passwordHash: data.password ? await hashSecret(data.password) : null,
      pinHash: data.pin ? await hashSecret(data.pin) : null,
    })
    .returning({ id: schema.users.id });
  return row!;
}

/** Contraseña/PIN vacíos en la edición = no se cambian. Desactivar cierra sus sesiones. */
export async function updateUser(db: Executor, id: string, data: UserData, actingUserId: string) {
  await assertUnique(db, data, id);
  if (id === actingUserId && (!data.active || data.role !== "admin")) {
    throw new UserError("No podés quitarte el rol de Dirección ni desactivarte a vos mismo.");
  }
  const [row] = await db
    .update(schema.users)
    .set({
      name: data.name,
      initials: data.initials,
      username: data.username,
      email: data.email,
      role: data.role,
      active: data.active,
      ...(data.password ? { passwordHash: await hashSecret(data.password) } : {}),
      ...(data.pin ? { pinHash: await hashSecret(data.pin) } : {}),
    })
    .where(eq(schema.users.id, id))
    .returning({ id: schema.users.id });
  if (!row) throw new UserError("El usuario no existe.");
  if (!data.active || data.password) await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
  return row;
}

export function listSettings(db: Executor) {
  return db.select().from(schema.appSettings).orderBy(asc(schema.appSettings.key));
}

export async function updateSetting(db: Executor, key: string, value: unknown) {
  const [row] = await db
    .update(schema.appSettings)
    .set({ value })
    .where(eq(schema.appSettings.key, key))
    .returning();
  if (!row) throw new UserError("Parámetro inexistente.");
  return row;
}

/** Últimos cambios auditados (BPM: quién, cuándo, qué). */
export async function listAudit(db: Executor, f: { table?: string; limit?: number } = {}) {
  return db
    .select({
      id: schema.auditLog.id,
      tableName: schema.auditLog.tableName,
      recordId: schema.auditLog.recordId,
      action: schema.auditLog.action,
      oldData: schema.auditLog.oldData,
      newData: schema.auditLog.newData,
      changedAt: schema.auditLog.changedAt,
      user: schema.users.name,
    })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.changedBy))
    .where(f.table ? eq(schema.auditLog.tableName, f.table) : undefined)
    .orderBy(desc(schema.auditLog.id))
    .limit(f.limit ?? 100);
}

/** Campos que cambiaron entre dos versiones de una fila. */
export function diffFields(
  oldData: unknown,
  newData: unknown,
): { field: string; from: unknown; to: unknown }[] {
  const a = (oldData ?? {}) as Record<string, unknown>;
  const b = (newData ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("updated_at");
  keys.delete("created_at");
  return [...keys]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => ({ field: k, from: a[k], to: b[k] }));
}
