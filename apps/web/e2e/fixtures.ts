import { test as base, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { DEMO_TODAY, TEST_DATABASE_URL } from "../playwright.config";

export { expect };
export { asRole } from "./roles";

/**
 * `sql`: acceso directo a chipa_test para preparar datos o verificar efectos (p. ej. auditoría).
 * Usar con moderación: los E2E deben ejercitar la UI.
 */
export const test = base.extend<{ sql: postgres.Sql }>({
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

/** Espera el toast de éxito de sonner. */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
}
