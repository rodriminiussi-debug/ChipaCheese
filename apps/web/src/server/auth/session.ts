import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, schema } from "@chipa/db";
import { db } from "@/server/db";
import { env } from "@/env";
import { can, type Permission, type Role } from "@/lib/rbac";

export const SESSION_COOKIE = "chipa_session";
const DAY = 24 * 60 * 60 * 1000;
/** Duración por rol: la tablet de planta es compartida, sesiones cortas. */
const TTL_BY_ROLE: Partial<Record<Role, number>> = { operator: 12 * 60 * 60 * 1000 };
const DEFAULT_TTL = 30 * DAY;

export interface SessionUser {
  id: string;
  name: string;
  initials: string;
  username: string;
  role: Role;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createSession(user: { id: string; role: Role }, userAgent?: string | null) {
  const token = randomBytes(32).toString("base64url");
  const ttl = TTL_BY_ROLE[user.role] ?? DEFAULT_TTL;
  const expiresAt = new Date(Date.now() + ttl);
  await db
    .insert(schema.sessions)
    .values({ id: sha256(token), userId: user.id, expiresAt, userAgent: userAgent ?? null });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

/** Id (hash) de la sesión actual, para cerrar las demás sin cortar esta. */
export async function currentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? sha256(token) : null;
}

/** Usuario de la sesión actual o null. Memoizado por request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = await db.query.sessions.findFirst({
    where: (s, { eq }) => eq(s.id, sha256(token)),
    with: { user: true },
  });
  if (!row || !row.user.active) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, row.id));
    return null;
  }
  const { id, name, initials, username, role } = row.user;
  return { id, name, initials, username, role };
});

/** Para páginas: exige sesión (redirige a /login). */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Para páginas: exige permiso (redirige a /sin-permiso). */
export async function requirePermission(permission: Permission | Permission[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect("/sin-permiso");
  return user;
}
