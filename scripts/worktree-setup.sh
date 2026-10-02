#!/usr/bin/env bash
# Prepara un worktree aislado para trabajar en paralelo: bases propias y puertos propios.
# Uso: scripts/worktree-setup.sh <slug> <puerto_e2e>     p. ej.  scripts/worktree-setup.sh m1 3301
set -euo pipefail
SLUG="${1:?slug requerido (m1, m2…)}"
PORT="${2:?puerto E2E requerido}"
cd "$(dirname "$0")/.."

docker compose up -d --wait >/dev/null
for db in "chipa_${SLUG}" "chipa_${SLUG}_test"; do
  docker compose exec -T postgres psql -U chipa -d chipa -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1 \
    || docker compose exec -T postgres createdb -U chipa "${db}"
done

sed -e "s#^DATABASE_URL=.*#DATABASE_URL=postgres://chipa:chipa@localhost:5433/chipa_${SLUG}#" .env.example > .env
{
  echo "TEST_DATABASE_URL=postgres://chipa:chipa@localhost:5433/chipa_${SLUG}_test"
  echo "E2E_PORT=${PORT}"
  echo "AI_MOCK=1"
} >> .env

pnpm install --frozen-lockfile >/dev/null
pnpm db:reset
echo "✔ worktree '${SLUG}' listo: base chipa_${SLUG}, tests chipa_${SLUG}_test, E2E en :${PORT}"
