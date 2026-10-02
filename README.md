# Chipa Cheese — Sistema de gestión

Sistema de gestión de Pacon SRL (Chipa Cheese): pedidos, compras con lectura de facturas por IA, stock y cobertura,
producción y lotes, despacho y trazabilidad, cuentas corrientes, BPM y mantenimiento, y tablero de resultados.

Basado en el relevamiento del 30/09/2026 (`docs/relevamiento.md`). Arquitectura en `docs/ARCHITECTURE.md`.

## Requisitos

Node 22+, pnpm 11, Docker.

## Primer arranque

```bash
cp .env.example .env
pnpm setup      # instala, levanta Postgres en Docker y carga seed + datos demo
pnpm dev        # http://localhost:3000
```

### Usuarios de desarrollo (contraseña `chipa1234`)

| Usuario           | Rol                           | PIN tablet                |
| ----------------- | ----------------------------- | ------------------------- |
| nahuel            | Dirección                     | —                         |
| af                | Jefa de producción            | 1111                      |
| logistica         | Logística                     | 2222                      |
| jt / sg / ea / sr | Operarios                     | 1234 / 2345 / 3456 / 4567 |
| local1            | Local                         | 5555                      |
| rtecnico          | Responsable técnico (lectura) | —                         |
| contadora         | Contadora (lectura)           | —                         |

Solo existen en desarrollo y tests; en producción se crean usuarios reales.

## Calidad

```bash
pnpm lint && pnpm typecheck && pnpm test   # unit + integración
pnpm test:e2e                              # Playwright (base aislada chipa_test)
```

CI en GitHub Actions corre todo, incluido E2E contra el build de producción.

## Despliegue

Ver `docs/DEPLOY.md` (Supabase + Vercel, o la imagen Docker de `apps/web/Dockerfile`).
