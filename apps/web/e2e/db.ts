import postgres from "postgres";
import { TEST_DATABASE_URL } from "../playwright.config";

/**
 * Aislamiento entre archivos de spec: global-setup arma una base PLANTILLA (seed + demo + sesiones
 * de cada rol) y antes de cada archivo se recrea la base de tests clonándola (CREATE DATABASE … TEMPLATE,
 * ~100 ms). Así ningún spec depende de lo que otro modificó.
 */
const url = new URL(TEST_DATABASE_URL);
export const TEST_DB = url.pathname.slice(1);
export const TEMPLATE_DB = `${TEST_DB}_tpl`;
export const TEMPLATE_URL = Object.assign(new URL(TEST_DATABASE_URL), {
  pathname: `/${TEMPLATE_DB}`,
}).toString();
const ADMIN_URL = Object.assign(new URL(TEST_DATABASE_URL), { pathname: "/postgres" }).toString();

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function admin<T>(fn: (sql: postgres.Sql) => Promise<T>) {
  const sql = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

/** Crea (vacía) la base plantilla. */
export const recreateTemplate = () =>
  admin(async (sql) => {
    await sql.unsafe(`DROP DATABASE IF EXISTS ${ident(TEMPLATE_DB)} WITH (FORCE)`);
    await sql.unsafe(`CREATE DATABASE ${ident(TEMPLATE_DB)}`);
  });

/** Recrea la base de tests como copia exacta de la plantilla (corta las conexiones abiertas). */
export const restoreTestDb = () =>
  admin(async (sql) => {
    await sql.unsafe(`DROP DATABASE IF EXISTS ${ident(TEST_DB)} WITH (FORCE)`);
    await sql.unsafe(`CREATE DATABASE ${ident(TEST_DB)} TEMPLATE ${ident(TEMPLATE_DB)}`);
  });
