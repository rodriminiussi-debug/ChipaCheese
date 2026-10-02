# Despliegue

## Opción A — Supabase + Vercel (recomendada, ~USD 25–45/mes)

1. Crear proyecto Supabase (región São Paulo). Copiar la connection string del **pooler** (transaction mode, puerto 6543) → `DATABASE_URL`.
2. Storage: crear bucket privado `chipa-files`; generar S3 access keys → `STORAGE_DRIVER=s3`, `S3_ENDPOINT=https://<ref>.supabase.co/storage/v1/s3`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET=chipa-files`.
3. Migrar: `DATABASE_URL=<url directa 5432> pnpm db:migrate`. Crear usuarios reales (no correr el seed demo en producción).
4. Vercel: importar el repo, Root Directory `apps/web`, variables: `DATABASE_URL`, `SESSION_SECRET` (32+ chars aleatorios), `APP_URL`, storage S3, `ANTHROPIC_API_KEY`.
5. Backups: Supabase Pro hace backup diario con PITR. Adicional: GitHub Action nocturna con `pg_dump` a un bucket.

## Opción B — Docker en un VPS

```bash
docker build -f apps/web/Dockerfile -t chipa-web .
docker run -d -p 3000:3000 --env-file .env.production chipa-web
```

Postgres gestionado o en el mismo host con volumen y `pg_dump` diario por cron.

## Checklist de salida a producción

- [ ] `SESSION_SECRET` aleatorio y distinto por entorno
- [ ] Usuarios reales con contraseñas propias y PIN para operarios
- [ ] Datos maestros validados con la empresa (ver "Supuestos a confirmar" del relevamiento)
- [ ] Backup verificado (restaurar en una base de prueba)
