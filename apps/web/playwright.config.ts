import { defineConfig, devices } from "@playwright/test";

/**
 * E2E contra una base aislada (chipa_test) que global-setup reinicia con el seed + demo.
 * Los tests corren en serie (workers: 1) porque comparten esa base.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://chipa:chipa@localhost:5433/chipa_test";
const PORT = Number(process.env.E2E_PORT ?? 3200);
export const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /\.tablet\.spec\.ts/ },
    // Tablet de planta (requisito: pantallas táctiles, botones grandes).
    { name: "tablet", use: { ...devices["Galaxy Tab S4"], isMobile: true }, testMatch: /\.tablet\.spec\.ts/ },
  ],
  webServer: {
    command: process.env.E2E_PROD ? `pnpm start --port ${PORT}` : `pnpm dev --port ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      AI_MOCK: "1",
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_DIR: ".data/test-uploads",
      NEXT_DIST_DIR_SUFFIX: "e2e",
    },
  },
});
