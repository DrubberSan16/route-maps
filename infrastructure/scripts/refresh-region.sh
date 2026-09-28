#!/usr/bin/env bash
# Transactional, unattended refresh of one prepared region.
#
#   ./infrastructure/scripts/refresh-region.sh ecuador
#   ./infrastructure/scripts/refresh-region.sh ecuador --record-current
#
# Sources are downloaded and validated first. Their content fingerprint is then
# compared with the accepted version; expensive graph/tile generation is skipped
# when nothing changed. Only runtime artifacts are backed up on the same
# filesystem and restored if generation or health checks fail. Intermediate
# GeoJSON layers are reproducible and are deliberately not duplicated (~1.6 GB
# for Ecuador). Only one refresh can run at a time.
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
# The national INEC package is about 4.7 GB while it is being converted and
# atomic outputs temporarily coexist with the accepted ones. Refuse to start a
# refresh without enough room for that peak.
MIN_FREE_GB="${MIN_FREE_GB:-10}"
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

# The graph build and the tile generator need about 6 GB of RAM for the whole country. A smaller
# server must not start them (it would starve the other services): the region is then built on a
# workstation and published with infrastructure/scripts/publish-region.sh.
MIN_MEMORY_GB="${MIN_MEMORY_GB:-6}"
MEMORY_KB="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo 2>/dev/null || echo 0)"
if (( ${MEMORY_KB:-0} < MIN_MEMORY_GB * 1024 * 1024 * 95 / 100 )); then
  echo "Memoria insuficiente: se requieren ${MIN_MEMORY_GB} GiB para regenerar $REGION en este equipo." >&2
  echo "Genérela en una estación de trabajo y publíquela con infrastructure/scripts/publish-region.sh." >&2
  exit 1
fi

FREE_KB="$(df -Pk "$STORAGE_PATH" | awk 'NR == 2 { print $4 }')"
REQUIRED_KB=$((MIN_FREE_GB * 1024 * 1024))
if (( FREE_KB < REQUIRED_KB )); then
  echo "Espacio insuficiente: se requieren ${MIN_FREE_GB} GiB libres para actualizar $REGION." >&2
  exit 1
fi

BACKUP_DIR="$(mktemp -d "$BACKUP_ROOT/$REGION.XXXXXX")"
NATIVE_REGION="$(jq -r --arg code "$REGION" \
  '.regions[] | select(.code == $code) | (.source.nativeRegion // .code)' \
  infrastructure/regions/regions.json)"
[[ -n "$NATIVE_REGION" ]] || {
  echo "La región $REGION no existe en el catálogo." >&2
  exit 64
}
NATIVE_DIR="$STORAGE_PATH/imports/native/$NATIVE_REGION"
MANIFEST="$(find "$STORAGE_PATH/maps" -type f -name "$REGION.region.json" -print -quit)"
MAP_REL=""
RUNTIME_NATIVE_FILES=(graph.bin search.ndjson build.json manifest.json climate-precipitation-regions.geojson)
mkdir -p "$BACKUP_DIR/native"
for file in "${RUNTIME_NATIVE_FILES[@]}"; do
  if [[ -f "$NATIVE_DIR/$file" ]]; then
    cp -a "$NATIVE_DIR/$file" "$BACKUP_DIR/native/$file"
    printf '%s\n' "$file" >>"$BACKUP_DIR/native/existing.txt"
  fi
done
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
  mkdir -p "$NATIVE_DIR"
  for file in "${RUNTIME_NATIVE_FILES[@]}"; do
    if grep -Fxq "$file" "$BACKUP_DIR/native/existing.txt" 2>/dev/null; then
      cp -a "$BACKUP_DIR/native/$file" "$NATIVE_DIR/$file"
    else
      rm -f -- "$NATIVE_DIR/$file"
    fi
  done
  docker compose exec -T backend node dist/src/cli/sync-regions.js >/dev/null 2>&1 || true
  rm -rf -- "$BACKUP_DIR"
  exit "$exit_code"
}
trap restore EXIT INT TERM

PREVIOUS="$(cat "$STATE_FILE" 2>/dev/null || source_version)"
docker compose --profile tools run --rm data-tools download "$REGION" --force-download
CURRENT="$(source_version)"
[[ -n "$CURRENT" ]] || {
  echo "No se pudo determinar la versión descargada para $REGION." >&2
  exit 1
}
if [[ "$CURRENT" == "$PREVIOUS" ]]; then
  printf '%s\n' "$CURRENT" >"$STATE_FILE"
  trap - EXIT INT TERM
  rm -rf -- "$BACKUP_DIR"
  echo "$REGION no cambió ($CURRENT); se conserva la publicación actual."
  exit 0
fi

docker compose --profile tools run --rm data-tools build "$REGION"
docker compose --profile tools run --rm data-tools map "$REGION"
docker compose --profile tools run --rm data-tools manifest "$REGION" >/dev/null
docker compose exec -T backend node dist/src/cli/sync-regions.js

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
