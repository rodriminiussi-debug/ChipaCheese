import "server-only";
import { createDb, type Db } from "@chipa/db";
import { env } from "@/env";

// Singleton: en dev el HMR re-evalúa módulos; guardamos la conexión en globalThis.
const g = globalThis as unknown as { __chipaDb?: Db };
export const db: Db = g.__chipaDb ?? createDb(env.DATABASE_URL).db;
if (env.NODE_ENV !== "production") g.__chipaDb = db;
