import { config } from "dotenv";
import { resolve } from "node:path";

// Los scripts corren desde packages/db: cargamos el .env de la raíz del monorepo.
config({ path: resolve(import.meta.dirname, "../../../.env"), quiet: true });

export const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://chipa:chipa@localhost:5433/chipa";
