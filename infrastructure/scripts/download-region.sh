#!/usr/bin/env bash
# Downloads and prepares an offline region into ./storage (STORAGE_PATH):
#
#   ./infrastructure/scripts/download-region.sh <region> [--skip-routing] [--water-polygons] [--force-download]
#
#   1. downloads the region's .osm.pbf from Geofabrik (or clips it from its
#      parent extract) into storage/imports and verifies it (MD5 + PBF check);
#   2. builds the visual map        storage/maps/<dir>/<region>.pmtiles;
#   3. prepares the routing graph   storage/routing/<region>/;
#   4. writes the region manifest and registers the region in the backend.
#
# Regions are defined in infrastructure/regions/regions.json (list them with
# `make regions`). Everything runs inside the data-tools image: the host only
# needs Docker. Nothing here runs during `docker compose up`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ $# -lt 1 || "$1" == -* ]]; then
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
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

served_region="$(docker compose exec -T routing printenv ROUTING_REGION 2>/dev/null | tr -d '\r' || true)"
if [[ "$served_region" == "$REGION" && " $* " != *" --skip-routing "* ]]; then
  echo "Restarting the routing service to load the new graph of $REGION..."
  docker compose restart routing
elif [[ " $* " != *" --skip-routing "* ]]; then
  echo "The routing service serves '${served_region:-<not running>}'. To route in $REGION set ROUTING_REGION=$REGION in .env and run: docker compose up -d routing"
fi
