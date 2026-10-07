#!/usr/bin/env bash
# Downloads audited sources and prepares an offline region into ./storage:
#
#   ./infrastructure/scripts/download-region.sh <region> [--skip-routing] [--water-polygons] [--force-download]
#
#   1. downloads and validates the region's official/public catalog;
#   2. builds the visual map storage/maps/<dir>/<region>.pmtiles;
#   3. builds the offline pack of the phone storage/routing/<region>/<region>.rmpack (roads and
#      search index, for routes and address search without connection; --skip-routing skips it);
#   4. writes the region manifest and registers it in the backend.
#
# Regions are defined in infrastructure/regions/regions.json (list them with
# `make regions`). Everything runs inside the data-tools image: the host only
# needs Docker. Nothing here runs during `docker compose up`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ $# -lt 1 || "$1" == -* ]]; then
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
  exit 64
fi
REGION="$1"

docker compose --profile tools run --rm data-tools prepare "$@"

if [[ -n "$(docker compose ps --status running -q backend 2>/dev/null)" ]]; then
  echo "Registering the region in the backend..."
  docker compose exec -T backend node dist/src/cli/sync-regions.js
else
  echo "The backend is not running: the region is registered when it starts (make up)."
fi

echo "El backend nativo lee la red vial auditada directamente; no requiere un servicio de rutas separado."
