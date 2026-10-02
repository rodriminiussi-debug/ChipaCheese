import { resolve } from "node:path";

/** Usuario del seed (packages/db/src/seed/data.ts) que representa cada rol en los E2E. */
export const ROLE_USERS = {
  admin: "nahuel",
  production_manager: "af",
  logistics: "logistica",
  operator: "jt",
  store: "local1",
  technical_lead: "rtecnico",
  accountant: "contadora",
} as const;
export type TestRole = keyof typeof ROLE_USERS;

/** Archivo de storageState para `test.use({ storageState: asRole("admin") })`. */
export const asRole = (role: TestRole) => resolve(import.meta.dirname, ".auth", `${role}.json`);
