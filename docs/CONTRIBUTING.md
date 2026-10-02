# Guía para desarrollar un módulo

1. Worktree aislado: `scripts/worktree-setup.sh <slug> <puerto>` (crea `chipa_<slug>` y `chipa_<slug>_test`, `.env` propio, reset con seed).
2. Leer `CLAUDE.md`, la sección del módulo en `docs/relevamiento.md`, `apps/web/AGENTS.md` (Next 16) y la implementación de referencia `apps/web/src/features/customers`.
3. Reglas de negocio nuevas → `packages/domain` con tests. Revisar primero lo que ya existe (`packages/domain/src/index.ts`).
4. Stock → solo vía `apps/web/src/features/stock/ledger.ts`.
5. Archivos compartidos (no tocar salvo lo indicado en tu tarea): `src/lib/rbac.ts`, `src/lib/nav.ts`, `src/server/*`, `src/components/ui/*`, `packages/db/src/schema/*`, `packages/db/src/seed/*`.
   - Etiquetas propias del módulo: `src/features/<módulo>/labels.ts`.
   - Si falta un componente shadcn: `cd apps/web && pnpm dlx shadcn@latest add <comp>` (no agregar paquetes npm nuevos).
6. Cambios de esquema: evitarlos (el esquema cubre el modelo de datos completo). Si son imprescindibles: editar el schema y `pnpm --filter @chipa/db exec drizzle-kit generate --name <slug>_<desc>`; explicarlo en el reporte.
7. Datos de prueba E2E: crearlos dentro del test (UI o fixture `sql`). Si necesitás datos demo persistentes, nuevo archivo `packages/db/src/seed/demo-<slug>.ts` invocado al final de `seedDemo`.
8. Done = `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` en verde + commits convencionales con el ID de Linear.
