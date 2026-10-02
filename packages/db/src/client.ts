import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PostgresJsDatabase<Schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Cualquier cosa sobre la que se puede ejecutar una consulta: la base o una transacción. */
export type Executor = Db | Tx;

export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, {
    max: opts.max ?? 10,
    prepare: false, // compatible con el pooler de Supabase (transaction mode)
    onnotice: () => {},
  });
  const db = drizzle(client, { schema, casing: "snake_case" });
  return { db, client };
}

/**
 * Ejecuta `fn` en una transacción marcada con el usuario actual, para que los triggers
 * de auditoría registren quién hizo cada cambio. TODA escritura de negocio pasa por acá.
 */
export async function withUser<T>(db: Db, userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    if (userId) await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
