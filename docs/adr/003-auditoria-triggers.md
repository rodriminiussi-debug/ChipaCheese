# ADR 003 — Auditoría por triggers

**Estado:** aceptada · 02/10/2026

## Contexto

Requerimiento no funcional: "cada dato guarda usuario, fecha y hora, y cada edición su historial. Es clave para BPM".

## Decisión

Trigger `AFTER INSERT/UPDATE/DELETE` genérico en todas las tablas de negocio que escribe en `audit_log`
(tabla, id, acción, datos anteriores y nuevos, usuario, timestamp). El usuario se pasa con
`set_config('app.user_id', …, true)` dentro de la transacción (`withUser()` en `@chipa/db`).
`audit_enable_all()` se ejecuta tras cada migración, así las tablas nuevas quedan cubiertas.
`audit_log` es inmutable.

## Consecuencias

- Imposible "olvidarse" de auditar desde el código.
- Toda escritura debe hacerse dentro de `withUser` (lo garantiza `action()`); si no, queda con usuario nulo.
