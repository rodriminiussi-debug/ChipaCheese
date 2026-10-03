import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(16),
  APP_URL: z.string().url().default("http://localhost:3000"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".data/uploads"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("chipa-files"),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Modelo de Claude para leer facturas (default: el Sonnet más reciente). */
  AI_MODEL: z.string().optional(),
  /** Fuerza el extractor de facturas simulado (tests E2E). */
  AI_MOCK: z.enum(["0", "1"]).default("0"),
});

/**
 * Durante `next build` (Docker, Vercel, CI) no hay secretos de runtime: se usan placeholders que nunca
 * se conectan (postgres.js abre conexiones recién en la primera consulta). En runtime la validación es estricta.
 */
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

export const env = schema.parse(
  isBuildPhase
    ? {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL ?? "postgres://build:build@127.0.0.1:5432/build",
        SESSION_SECRET: process.env.SESSION_SECRET ?? "build-phase-placeholder-secret",
      }
    : process.env,
);
