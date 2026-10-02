# ADR 005 — Autenticación y permisos

**Estado:** aceptada · 02/10/2026

## Decisión

- Sesiones propias en tabla `sessions` (token aleatorio en cookie httpOnly; en base el SHA-256). Hash de contraseñas y PIN con Argon2.
- 7 roles del relevamiento con matriz de permisos en `apps/web/src/lib/rbac.ts`.
- Tablet de planta: ingreso tocando el nombre + PIN de 4 dígitos, sesión de 12 h.

## Por qué

Requisitos muy específicos (PIN con guantes, roles externos de solo lectura) y cero costo/dependencia de un proveedor de identidad.

## Consecuencias

Si en el futuro se requiere SSO, se agrega como otro método de `createSession` sin tocar los permisos.
