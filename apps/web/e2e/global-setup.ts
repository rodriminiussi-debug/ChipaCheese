import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { resetDatabase } from "@chipa/db/reset";
import { BASE_URL, TEST_DATABASE_URL } from "../playwright.config";
import { ROLE_USERS, type TestRole } from "./roles";

/** Reinicia chipa_test y crea una sesión por rol (sin pasar por la UI, más rápido y estable). */
export default async function globalSetup() {
  await resetDatabase(TEST_DATABASE_URL, { demo: true });
  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  const dir = resolve(import.meta.dirname, ".auth");
  await mkdir(dir, { recursive: true });
  const { hostname } = new URL(BASE_URL);
  try {
    for (const [role, username] of Object.entries(ROLE_USERS) as [TestRole, string][]) {
      const [user] = await sql<{ id: string }[]>`select id from users where username = ${username}`;
      if (!user) throw new Error(`usuario de test ${username} no existe en el seed`);
      const token = randomBytes(32).toString("base64url");
      const id = createHash("sha256").update(token).digest("hex");
      const expires = new Date(Date.now() + 24 * 3600 * 1000);
      await sql`insert into sessions (id, user_id, expires_at) values (${id}, ${user.id}, ${expires})`;
      const state = {
        cookies: [
          {
            name: "chipa_session",
            value: token,
            domain: hostname,
            path: "/",
            expires: Math.floor(expires.getTime() / 1000),
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
          },
        ],
        origins: [],
      };
      await writeFile(resolve(dir, `${role}.json`), JSON.stringify(state));
    }
  } finally {
    await sql.end();
  }
}
