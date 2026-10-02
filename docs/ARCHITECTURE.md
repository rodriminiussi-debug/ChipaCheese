# Arquitectura

## Vista general

```
                ┌───────────────────────────── apps/web (Next.js 16) ─────────────────────────────┐
 PC / celular → │ app/(app)/*  páginas por módulo (RSC)        app/(planta)/*  tablet de planta     │
 Tablet planta →│ features/<módulo>/actions.ts  Server Actions ─ action(): sesión + RBAC + zod     │
                │ features/<módulo>/service.ts  casos de uso (Drizzle)   ─ withUser(): auditoría    │
                │ server/  auth (sesiones), storage (local/S3), settings, db                       │
                └───────────────┬──────────────────────────────────────┬──────────────────────────┘
                                │ reglas puras                         │ SQL
                        packages/domain                         packages/db (Drizzle)
                   costeo · FEFO · cobertura · lotes        esquema · vistas · migraciones · seed
                   cuentas corrientes · plan · fechas       triggers de auditoría
                                                                       │
                                                         PostgreSQL 16 (Docker local / Supabase)
```

## Decisiones (ADR)

| #                                    | Decisión                                                                 | Por qué                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [001](adr/001-stack.md)              | Monorepo pnpm + Turborepo, Next.js 16, TypeScript estricto               | Un solo lenguaje, despliegue simple (Vercel o Docker), costo bajo                             |
| [002](adr/002-postgres-drizzle.md)   | PostgreSQL + Drizzle ORM, Supabase solo como Postgres/Storage gestionado | SQL tipado, migraciones versionadas, sin lock-in (corre en cualquier Postgres)                |
| [003](adr/003-auditoria-triggers.md) | Auditoría por triggers de Postgres                                       | BPM exige usuario/fecha/hora e historial de cada edición, imposible de "olvidar" en el código |
| [004](adr/004-stock-ledger.md)       | Stock como libro mayor de movimientos                                    | Trazabilidad y saldos siempre reconstruibles; nada de saldos editables                        |
| [005](adr/005-auth.md)               | Sesiones propias en base + RBAC + PIN para tablet                        | 7 roles del relevamiento, tablet compartida con guantes, sin dependencia externa              |

## Módulos y rutas

| Módulo                          | Rutas                                                                                             | Feature                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| M1 Pedidos y clientes           | `/pedidos`, `/clientes`                                                                           | `features/orders`, `features/customers`                  |
| M2 Compras y proveedores        | `/compras`, `/proveedores`                                                                        | `features/purchases`, `features/suppliers`               |
| M3 Stock y cobertura            | `/stock`                                                                                          | `features/stock`                                         |
| M4 Producción y lotes           | `/produccion`, `/produccion/receta`, `/personas`, `/planta/*`                                     | `features/production`, `features/people`                 |
| M5 Despacho y reparto           | `/despacho`                                                                                       | `features/dispatch`                                      |
| M6 Ventas y cobranzas           | `/cobranzas`, `/precios`, `/local`                                                                | `features/billing`, `features/pricing`, `features/store` |
| M7 Calidad, BPM y mantenimiento | `/calidad`, `/calidad/trazabilidad`, `/mantenimiento`, `/planta/limpieza`, `/planta/temperaturas` | `features/quality`, `features/maintenance`               |
| M8 Tablero y costeo             | `/tablero`, `/costos`                                                                             | `features/dashboard`, `features/costing`                 |

## Flujo de información (del relevamiento)

Un pedido entra por M1 → se produce en M4 consumiendo stock de M3 (alimentado por compras M2) → sale por M5
con su lote (FEFO) → se cobra en M6. M7 registra y traza cada lote; M8 lee todos los módulos.

## Seguridad

- Cookie de sesión httpOnly; en base solo se guarda el SHA-256 del token.
- `proxy.ts` hace un chequeo optimista; la autorización real está en `requirePermission()` (páginas) y `action()` (mutaciones).
- Operarios: sesión de 12 h; resto: 30 días.
- `audit_log` es de solo lectura (trigger que bloquea UPDATE/DELETE).

## Operación

- Backups: Supabase hace backup diario (plan Pro) + `pg_dump` programado (ver `docs/DEPLOY.md`).
- Exportaciones: Excel (exceljs) y PDF con formato de planillas ASSAL (@react-pdf/renderer).
