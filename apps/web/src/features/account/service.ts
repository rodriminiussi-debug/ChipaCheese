import { and, eq, ne, schema, type Executor } from "@chipa/db";
import { hashSecret, verifySecret } from "@/server/auth/password";
import { UserError } from "@/server/errors";

/** Mi cuenta: cambiar la propia contraseña y el propio PIN. */

async function loadUser(db: Executor, userId: string) {
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user || !user.active) throw new UserError("Tu usuario no está activo.");
  return user;
}

/**
 * Cambia la contraseña. Pide la actual (si el usuario nunca tuvo contraseña, como los operarios que entran
 * con PIN, se pide el PIN) y cierra TODAS las otras sesiones, menos la actual.
 */
export async function changePassword(
  db: Executor,
  userId: string,
  keepSessionId: string | null,
  input: { current: string; password: string },
) {
  const user = await loadUser(db, userId);
  const ok = await verifySecret(user.passwordHash ?? user.pinHash, input.current);
  if (!ok)
    throw new UserError(
      user.passwordHash ? "La contraseña actual no es correcta." : "El PIN actual no es correcto.",
      { current: ["No es correcta"] },
    );
  await db
    .update(schema.users)
    .set({ passwordHash: await hashSecret(input.password) })
    .where(eq(schema.users.id, userId));
  const closed = await db
    .delete(schema.sessions)
    .where(
      keepSessionId
        ? and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, keepSessionId))
        : eq(schema.sessions.userId, userId),
    )
    .returning({ id: schema.sessions.id });
  return { closedSessions: closed.length };
}

/** Cambia el PIN (4 a 6 dígitos). Pide la contraseña o el PIN actual. */
export async function changePin(db: Executor, userId: string, input: { current: string; pin: string }) {
  const user = await loadUser(db, userId);
  const ok =
    (await verifySecret(user.passwordHash, input.current)) ||
    (await verifySecret(user.pinHash, input.current));
  if (!ok)
    throw new UserError("La contraseña o el PIN actual no es correcto.", { current: ["No es correcto"] });
  await db
    .update(schema.users)
    .set({ pinHash: await hashSecret(input.pin) })
    .where(eq(schema.users.id, userId));
  return { ok: true as const };
}
