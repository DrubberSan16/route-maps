#!/usr/bin/env bash
# Transactional, unattended refresh of one prepared region.
#
#   ./infrastructure/scripts/refresh-region.sh ecuador
#   ./infrastructure/scripts/refresh-region.sh ecuador --record-current
#
# The upstream fingerprint is checked first. Existing map/routing artifacts are
# backed up on the same filesystem and restored if generation or health checks
# fail. Only one refresh can run at a time.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

REGION="${1:-}"
MODE="${2:-}"
[[ "$REGION" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]] || {
  echo "Uso: $0 <región> [--record-current]" >&2
  exit 64
}
[[ -z "$MODE" || "$MODE" == "--record-current" ]] || {
  echo "Opción desconocida: $MODE" >&2
  exit 64
}

STORAGE_PATH="${STORAGE_PATH:-$ROOT/storage}"
STATE_DIR="$STORAGE_PATH/.state"
BACKUP_ROOT="$STORAGE_PATH/.refresh-backups"
LOCK_FILE="$STORAGE_PATH/.refresh.lock"
BASE_URL="${BASE_URL:-http://127.0.0.1:8090}"
MIN_FREE_GB="${MIN_FREE_GB:-4}"
STATE_FILE="$STATE_DIR/$REGION.source-version"

mkdir -p "$STATE_DIR" "$BACKUP_ROOT"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Ya existe una actualización cartográfica en ejecución." >&2
  exit 75
fi

source_version() {
  docker compose --profile tools run --rm data-tools source-version "$REGION" | tail -n 1
}

if [[ "$MODE" == "--record-current" ]]; then
  CURRENT="$(source_version)"
  printf '%s\n' "$CURRENT" >"$STATE_FILE"
  echo "Versión actual registrada para $REGION: $CURRENT"
  exit 0
fi

FREE_KB="$(df -Pk "$STORAGE_PATH" | awk 'NR == 2 { print $4 }')"
REQUIRED_KB=$((MIN_FREE_GB * 1024 * 1024))
if (( FREE_KB < REQUIRED_KB )); then
  echo "Espacio insuficiente: se requieren ${MIN_FREE_GB} GiB libres para actualizar $REGION." >&2
  exit 1
fi

BACKUP_DIR="$(mktemp -d "$BACKUP_ROOT/$REGION.XXXXXX")"
MANIFEST="$(find "$STORAGE_PATH/maps" -type f -name "$REGION.region.json" -print -quit)"
MAP_REL=""
if [[ -n "$MANIFEST" ]]; then
  MAP_REL="$(jq -r '.mapFile // empty' "$MANIFEST")"
  [[ "$MAP_REL" != /* && "$MAP_REL" != *".."* ]] || {
    echo "Ruta de mapa insegura en $MANIFEST" >&2
    exit 1
  }
  mkdir -p "$BACKUP_DIR/maps/$(dirname "$MAP_REL")"
  cp -a "$STORAGE_PATH/maps/$MAP_REL" "$BACKUP_DIR/maps/$MAP_REL"
  cp -a "$MANIFEST" "$BACKUP_DIR/maps/$(dirname "$MAP_REL")/$REGION.region.json"
fi
restore() {
  local exit_code=$?
  trap - EXIT INT TERM
  echo "La actualización falló; restaurando los artefactos anteriores de $REGION." >&2
  if [[ -n "$MAP_REL" && -f "$BACKUP_DIR/maps/$MAP_REL" ]]; then
    rm -f -- "$STORAGE_PATH/maps/$MAP_REL"
    cp -a "$BACKUP_DIR/maps/$MAP_REL" "$STORAGE_PATH/maps/$MAP_REL"
    cp -a "$BACKUP_DIR/maps/$(dirname "$MAP_REL")/$REGION.region.json" "$MANIFEST"
  fi
  docker compose exec -T backend node dist/src/cli/sync-regions.js >/dev/null 2>&1 || true
  rm -rf -- "$BACKUP_DIR"
  exit "$exit_code"
}
trap restore EXIT INT TERM

./infrastructure/scripts/download-region.sh "$REGION" --force-download
CURRENT="$(source_version)"
[[ -n "$CURRENT" ]] || {
  echo "No se pudo determinar la versión descargada para $REGION." >&2
  exit 1
}

HEALTH=""
for _ in $(seq 1 40); do
  HEALTH="$(curl --silent --show-error --max-time 20 "$BASE_URL/health" || true)"
  if jq -e '.status == "ok" and .services.database == "up" and .services.routing == "up"' \
    <<<"$HEALTH" >/dev/null 2>&1; then
    break
  fi
  sleep 15
done
jq -e '.status == "ok" and .services.database == "up" and .services.routing == "up"' \
  <<<"$HEALTH" >/dev/null
REGION_JSON="$(curl --fail --silent --show-error --max-time 20 \
  "$BASE_URL/api/v1/maps/regions/$REGION")"
DOWNLOAD_URL="$(jq -r '.data.mapDownloadUrl' <<<"$REGION_JSON")"
EXPECTED_SHA="$(jq -r '.data.checksum' <<<"$REGION_JSON")"
HEADERS="$(mktemp "$BACKUP_DIR/headers.XXXXXX")"
MAGIC="$(curl --fail --silent --show-error --max-time 20 -D "$HEADERS" \
  -H 'Range: bytes=0-6' "$BASE_URL$DOWNLOAD_URL")"
[[ "$MAGIC" == "PMTiles" ]]
grep -qi '^HTTP/.* 206' "$HEADERS"
grep -qi "^X-Checksum-Sha256: $EXPECTED_SHA" "$HEADERS"

printf '%s\n' "$CURRENT" >"$STATE_FILE"
trap - EXIT INT TERM
rm -rf -- "$BACKUP_DIR"
echo "$REGION actualizado y validado correctamente ($CURRENT)."
