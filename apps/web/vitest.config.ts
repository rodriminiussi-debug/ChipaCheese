import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { resolve as resolvePath } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: resolvePath(import.meta.dirname, "../../.env"), quiet: true });

/**
 * Tests de integración de servicios (src/features/** /service.ts) contra chipa_test.
 * `server-only` se reemplaza por un módulo vacío fuera de Next.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
      "server-only": resolve(import.meta.dirname, "tests/empty.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://chipa:chipa@localhost:5433/chipa_test",
      SESSION_SECRET: "test-secret-0123456789",
      NODE_ENV: "test",
      AI_MOCK: "1",
    },
  },
});
