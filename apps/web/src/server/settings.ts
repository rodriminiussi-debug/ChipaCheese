import "server-only";
import { cache } from "react";
import { schema } from "@chipa/db";
import { db } from "@/server/db";

/** Parámetros del negocio (tabla app_settings). Ver packages/db/src/seed/data.ts → SETTINGS. */
export const getSettings = cache(async (): Promise<Record<string, unknown>> => {
  const rows = await db.select().from(schema.appSettings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
});

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const all = await getSettings();
  return (all[key] as T | undefined) ?? fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
}
