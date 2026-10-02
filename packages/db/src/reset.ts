import { isMain } from "./is-main";
import postgres from "postgres";
import { DATABASE_URL } from "./env";
import { runMigrations } from "./migrate";
import { seed } from "./seed";

/** Borra y recrea el esquema, migra y carga los datos semilla. Solo para desarrollo y tests. */
export async function resetDatabase(url = DATABASE_URL, opts: { demo?: boolean } = {}) {
  if (process.env.NODE_ENV === "production") throw new Error("reset deshabilitado en producción");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  await client.unsafe(
    "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
  );
  await client.end();
  await runMigrations(url);
  await seed(url, opts);
}

if (isMain(import.meta.url)) {
  resetDatabase(DATABASE_URL, { demo: !process.argv.includes("--no-demo") })
    .then(() => console.log("✔ base reiniciada"))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
