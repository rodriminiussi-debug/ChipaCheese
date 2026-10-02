# ADR 002 — PostgreSQL + Drizzle

**Estado:** aceptada · 02/10/2026

## Decisión

PostgreSQL 16 con Drizzle ORM. En desarrollo, Docker Compose; en producción, Supabase usado **solo como Postgres y Storage gestionados** (conexión por pooler, `prepare: false`).
No se usa el cliente de Supabase ni RLS: la autorización está en el servidor de la app.

## Por qué

- Tipos de punta a punta, SQL explícito, migraciones versionadas revisables.
- Portabilidad: cualquier Postgres (Neon, RDS, VPS) funciona igual.
- Vistas SQL para saldos (`v_ingredient_stock`, `v_product_stock`, `v_ingredient_last_price`).

## Consecuencias

- Toda escritura pasa por el servidor (no hay acceso directo desde el navegador).
