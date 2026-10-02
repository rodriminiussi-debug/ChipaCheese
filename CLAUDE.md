# Chipa Cheese — Sistema de gestión (Pacon SRL)

Fuente funcional: `docs/relevamiento.md` (RF-01…RF-42, reglas de negocio 1–11, modelo de datos).
Backlog: Linear, proyecto "Chipa Cheese — Sistema de Gestión" (equipo ROD). Arquitectura: `docs/ARCHITECTURE.md`.

## Comandos

```
pnpm setup              # install + docker (Postgres :5433) + reset de base con seed y demo
pnpm dev                # Next en :3000  (usuarios de dev: ver README)
pnpm db:generate        # generar migración tras cambiar packages/db/src/schema/*
pnpm db:reset           # recrear base dev (migraciones + seed + demo)
pnpm lint && pnpm typecheck && pnpm test   # todo debe pasar antes de commitear
pnpm test:e2e           # Playwright (usa la base chipa_test, la reinicia sola)
```

Tests de un solo paquete: `pnpm --filter web exec vitest run src/features/orders`, `pnpm --filter web test:e2e e2e/pedidos.spec.ts`.

## Estructura

- `packages/domain` — reglas de negocio PURAS (costeo, FEFO, cobertura, fechas, lote, cuentas corrientes…). Sin I/O. 100 % testeado. Si una cuenta es regla de negocio, va acá, no en la app.
- `packages/db` — Drizzle: `src/schema/*.ts` (un archivo por área), vistas (`views.ts`), migraciones en `drizzle/`, seed en `src/seed/` (`data.ts` maestros reales del relevamiento, `demo.ts` datos de demo de los que dependen los E2E). Auditoría por triggers (`src/audit.sql`).
- `apps/web` — Next.js 16 App Router. **Leer `apps/web/AGENTS.md`: Next 16 tiene breaking changes** (proxy en vez de middleware, APIs async, `PageProps<"/ruta">` globales generados por `next typegen`).

## Patrón de un módulo (copiar `src/features/customers` — es la implementación de referencia)

```
src/features/<modulo>/
  schemas.ts      zod compartido cliente/servidor (usar helpers de src/lib/zod.ts; esquemas IDEMPOTENTES)
  service.ts      lógica de aplicación: funciones (db: Executor, ...) → consultas y escrituras Drizzle.
                  Sin "use server", sin cookies, sin Next: testeable con inRollback().
  service.test.ts integración contra chipa_test con tests/helpers.ts → inRollback("usuario", async (tx) => …)
  actions.ts      "use server"; cada acción = action({ permission, schema }, (input, { tx, user }) => service(...))
                  + revalidatePath. NUNCA escribir en la base fuera de action()/withUser (auditoría).
  components/     componentes cliente/servidor del módulo
src/app/(app)/<ruta>/page.tsx   delgada: requirePermission(...) → service → componentes
apps/web/e2e/<modulo>.spec.ts   flujo feliz + 1 caso de error + 1 caso de permisos
```

- Lecturas en páginas: `service.ts` con `db` de `@/server/db`. Escrituras: solo Server Actions con `action()`.
- Permisos: `src/lib/rbac.ts` (matriz por rol del relevamiento). Página: `await requirePermission("x:read")`. UI: `can(user.role, "x:write")` para ocultar botones; el servidor siempre revalida.
- Errores de negocio: `throw new UserError("mensaje para el usuario", { campo: ["detalle"] })`.
- Formularios: react-hook-form + `zodResolver(schema)` + `useAction(serverAction, { success: "…" })` (toast). Ver `customer-form.tsx`.
- Stock: TODO movimiento de stock inserta en `stock_movements` (signo + entra / − sale) con `refTable/refId` del documento origen. Saldos: vistas `v_ingredient_stock`, `v_product_stock`. Nunca guardar saldos en columnas.
- Precios: último precio sin IVA en `v_ingredient_last_price`. IVA se toma de la factura (Regla 11).
- Fechas de negocio: `todayAR()` de `src/lib/dates.ts` (el server puede estar en UTC). Columnas `date` como string ISO.
- Formato UI: componentes `Money`, `Kg`, `Num`, `DateText` (`src/components/app/format.tsx`) — español argentino.
- Etiquetas de enums en español: `src/lib/labels.ts`.
- Parámetros del negocio (capacidad, costo hora, umbrales): `getSetting(key, fallback)` de `src/server/settings.ts`.
- Archivos (fotos de facturas, conformidades): `putFile/fileUrl` de `src/server/storage.ts`.
- Navegación: `src/lib/nav.ts`. Modo planta (tablet): `src/app/(planta)/planta/*` con botones grandes (h-16+), texto ≥ lg, usable con guantes; carga < 30 s.
- UI: shadcn/ui en `src/components/ui` (generado: no editar a mano; agregar con `pnpm dlx shadcn@latest add <comp>` dentro de apps/web). Componentes propios en `src/components/app`.
- Idioma: UI y mensajes en español rioplatense; código, nombres de tablas y variables en inglés.

## Base de datos

- Cambiar esquema → `pnpm db:generate` → revisar el SQL generado en `packages/db/drizzle/` → `pnpm db:reset`. No editar migraciones ya commiteadas.
- Columnas: `numeric` en modo number (`money()`, `qty()`), PK uuid, `timestamps()`. Fechas de negocio `day()`.
- Las tablas nuevas quedan auditadas automáticamente (`audit_enable_all()` corre tras cada migración).
- Si agregás datos demo para tus E2E, hacelo en `packages/db/src/seed/demo.ts` sin romper los existentes.

## Tests (Definition of Done)

- Regla de negocio nueva → test unitario en `packages/domain`.
- Servicio → test de integración con `inRollback`.
- Pantalla → E2E en `apps/web/e2e/` usando `test.use({ storageState: asRole("<rol>") })` y selectores accesibles (`getByRole`, `getByLabel`). `data-testid` solo si no hay alternativa.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` en verde.

## Commits

Conventional commits en español con el issue de Linear: `feat(pedidos): carga rápida de pedido [ROD-261]`.
