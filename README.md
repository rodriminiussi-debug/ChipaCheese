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

## Datos de presentación

Para mostrar el sistema con una operación realista (no los datos mínimos de los tests):

```bash
pnpm db:showcase                 # recrea la base de desarrollo con ~3 meses simulados
APP_TODAY=2026-10-02 pnpm dev    # la app "vive" el 02/10/2026, último día del seed
```

Simula julio–septiembre de 2026 y los primeros días de octubre: ~100 kg/día de producción con consumos por lote,
compras semanales con inflación de precios, ~240 pedidos con remitos, rutas y facturas, cobros (con deuda vencida
y un cheque rechazado), ventas diarias del local, registros BPM, mantenimiento y gastos fijos completos.
Es determinista (misma semilla, mismos datos). Septiembre da ventas por ~$18,3M y un resultado de ~$0,6M,
coherente con la tesis del relevamiento: el negocio no cubre los ~$9M de retiros estimados.

## Calidad

```bash
pnpm lint && pnpm typecheck && pnpm test   # unit + integración
pnpm test:e2e                              # Playwright (base aislada chipa_test)
```

CI en GitHub Actions corre todo, incluido E2E contra el build de producción.

## Despliegue

Ver `docs/DEPLOY.md` (Supabase + Vercel, o la imagen Docker de `apps/web/Dockerfile`).
