import { isMain } from "./is-main";
import postgres from "postgres";
import { createDb } from "./client";
import { DATABASE_URL } from "./env";
import { runMigrations } from "./migrate";
import { seedMasters } from "./seed";
import { seedShowcase, type ShowcaseSummary } from "./seed/showcase";

/**
 * Base de presentación: borra y recrea el esquema, migra, carga los maestros y simula ~3 meses de operación
 * (julio a septiembre de 2026 y los primeros días de octubre). NO carga el seed demo de los tests.
 * Solo para desarrollo y presentaciones: mismo guard que `reset.ts`.
 */
export async function resetAndSeedShowcase(url = DATABASE_URL): Promise<ShowcaseSummary> {
  if (process.env.NODE_ENV === "production") throw new Error("showcase deshabilitado en producción");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  await client.unsafe(
    "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
  );
  await client.end();
  await runMigrations(url);

  const { db, client: seedClient } = createDb(url, { max: 1 });
  try {
    return await db.transaction(async (tx) => {
      const refs = await seedMasters(tx);
      return seedShowcase(tx, refs);
    });
  } finally {
    await seedClient.end();
  }
}

if (isMain(import.meta.url)) {
  const started = Date.now();
  resetAndSeedShowcase(DATABASE_URL)
    .then((summary) => {
      const r = summary.rows;
      console.log(
        `✔ base de presentación cargada en ${((Date.now() - started) / 1000).toFixed(1)} s: ` +
          `${summary.productionDays} producciones (${summary.producedKg} kg), ${r.orders} pedidos, ${r.dispatches} remitos, ` +
          `${r.salesInvoices} facturas, ${r.customerPayments} cobros, ${r.storeSales} ventas del local, ${r.stockMovements} movimientos de stock.`,
      );
      console.log("  Para verla con la fecha del seed: APP_TODAY=2026-10-02 pnpm dev");
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
