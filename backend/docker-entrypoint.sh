#!/bin/sh
# Entry point of the backend container:
#   1. applies pending Prisma migrations (RUN_MIGRATIONS=true, default);
#   2. loads the demo data when SEED_DEMO_DATA=true (idempotent);
#   3. runs the given command (the API by default).
# Other commands can be run with the same image, e.g.
#   docker compose exec backend node dist/src/cli/sync-regions.js
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[backend] Applying database migrations"
  ./node_modules/.bin/prisma migrate deploy
fi

if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  echo "[backend] Loading demo data (SEED_DEMO_DATA=true)"
  node dist/prisma/seed.js
fi

exec "$@"
