import { withUser, type Tx } from "@chipa/db";
import { db } from "@/server/db";

/**
 * Ejecuta `fn` en una transacción que se revierte al final: cada test arranca del seed limpio.
 * `username`: usuario del seed con el que se audita.
 */
export async function inRollback(username: string, fn: (tx: Tx, userId: string) => Promise<void>) {
  const user = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.username, username) });
  if (!user) throw new Error(`usuario ${username} no existe`);
  const rollback = new Error("__rollback__");
  try {
    await withUser(db, user.id, async (tx) => {
      await fn(tx, user.id);
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
}
