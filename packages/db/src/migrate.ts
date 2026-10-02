import { isMain } from "./is-main";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";
import { DATABASE_URL } from "./env";

export async function runMigrations(url = DATABASE_URL) {
  const { db, client } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: resolve(import.meta.dirname, "../drizzle") });
    // Triggers de auditoría: idempotente, cubre tablas nuevas de cada migración.
    await client.unsafe(readFileSync(resolve(import.meta.dirname, "audit.sql"), "utf8"));
  } finally {
    await client.end();
  }
}

if (isMain(import.meta.url)) {
  runMigrations()
    .then(() => console.log("✔ migraciones aplicadas"))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
