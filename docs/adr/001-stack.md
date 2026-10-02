# ADR 001 — Stack

**Estado:** aceptada · 02/10/2026

## Contexto

PyME de alimentos, presupuesto de infraestructura de decenas de USD/mes, uso en PC, celular y una tablet de planta.
El relevamiento sugiere React + Supabase + Vercel (mismo stack que otro cliente).

## Decisión

- Monorepo **pnpm + Turborepo**: `apps/web`, `packages/db`, `packages/domain`.
- **Next.js 16** (App Router, Server Components, Server Actions) como única app: UI + backend.
- **TypeScript estricto** en todo el código (`noUncheckedIndexedAccess`).
- **Tailwind 4 + shadcn/ui** (Radix) para la UI; instalable como PWA.
- **Vitest** (unit/integración) y **Playwright** (E2E desktop + tablet).

## Consecuencias

- Sin API REST separada: si en Fase 3 se necesita (WhatsApp, n8n), se agregan Route Handlers sobre los mismos `service.ts`.
- Las reglas de negocio viven en `packages/domain`, reutilizables desde un worker o una app móvil futura.
