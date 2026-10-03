import { test as base, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { BASE_URL, DEMO_TODAY, TEST_DATABASE_URL } from "../playwright.config";
import { restoreTestDb } from "./db";

export { expect };
export { asRole } from "./roles";

/**
 * `sql`: acceso directo a chipa_test para preparar datos o verificar efectos (p. ej. auditoría).
 * Usar con moderación: los E2E deben ejercitar la UI.
 */
let lastFile: string | undefined;

/**
 * Tras recrear la base, el pool de conexiones del servidor tiene sockets cortados: pedimos el health
 * check (que consulta la base) hasta tener varias respuestas OK seguidas, así el pool se reconecta.
 */
async function waitForAppDb() {
  let ok = 0;
  for (let i = 0; i < 50 && ok < 5; i++) {
    const res = await fetch(`${BASE_URL}/api/health`).catch(() => null);
    ok = res?.ok ? ok + 1 : 0;
    if (!res?.ok) await new Promise((r) => setTimeout(r, 100));
  }
}

export const test = base.extend<{ sql: postgres.Sql; isolateFile: void }>({
  // Cada archivo de spec arranca de la base demo intacta (los tests de un mismo archivo sí comparten estado).
  isolateFile: [
    async ({}, use, testInfo) => {
      if (testInfo.file !== lastFile) {
        await restoreTestDb();
        await waitForAppDb();
        lastFile = testInfo.file;
      }
      await use();
    },
    { auto: true },
  ],
  // Reloj del navegador congelado en el día de los datos demo (el servidor usa APP_TODAY).
  page: async ({ page }, use) => {
    await page.clock.setSystemTime(new Date(`${DEMO_TODAY}T10:00:00-03:00`));
    await use(page);
  },
  sql: async ({}, use) => {
    const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
    await use(sql);
    await sql.end();
  },
});

/** Día de negocio relativo al día congelado de los tests (DEMO_TODAY), como YYYY-MM-DD. */
export function demoDay(offset = 0): string {
  const d = new Date(`${DEMO_TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Espera el toast de éxito de sonner. */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
}
