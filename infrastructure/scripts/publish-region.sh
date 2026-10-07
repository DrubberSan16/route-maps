#!/usr/bin/env bash
# Publishes a native region built on a workstation to an application server over SSH.
#
#   ./infrastructure/scripts/publish-region.sh ecuador ovh-serverSoft
#   ./infrastructure/scripts/publish-region.sh ecuador ovh-serverSoft /opt/route-maps
#
# Converting the national INEC packages needs about 6 GB of RAM and 15 GB of free disk; a small
# server only needs the results. This script copies them (the maps of every catalog region built
# from the same native catalog with their relief, satellite and overlay archives, their manifests,
# the road graph, the search index and the climate layer) to a staging folder on the server, verifies every SHA-256 there, swaps them in (data
# first, manifests last), restarts the backend so it loads the new graph and index, and registers
# the manifests. The replaced files are kept in storage/.publish-backup until the next publication.
#
# Requirements: bash, ssh/scp and Python 3 on the workstation; sudo and Docker on the server.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

REGION="${1:-}"
HOST="${2:-}"
REMOTE_ROOT="${3:-/opt/route-maps}"
[[ "$REGION" =~ ^[a-z0-9][a-z0-9-]{1,62}$ && -n "$HOST" ]] || {
  echo "Uso: $0 <región> <host-ssh> [directorio remoto]" >&2
  exit 64
}
PYTHON="$(command -v python3 || command -v python || true)"
for dependency in ssh scp sha256sum "$PYTHON"; do
  [[ -n "$dependency" ]] && command -v "$dependency" >/dev/null 2>&1 || {
    echo "Falta una dependencia requerida: ${dependency:-python3}" >&2
    exit 69
  }
done

STORAGE="${STORAGE_PATH:-$ROOT/storage}"
CATALOG="$ROOT/infrastructure/regions/regions.json"

# "<native catalog>" on the first line, then "map <code> <map dir> <map checksum>" for every region
# built from that catalog, each followed by "asset <code> <file> <checksum>" for the extra archives
# (relief, satellite, overlays) its manifest lists. Checksums come from the manifests.
PLAN="$("$PYTHON" - "$CATALOG" "$REGION" "$STORAGE" <<'PY'
import json, sys
from pathlib import Path

catalog = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
code, storage = sys.argv[2], Path(sys.argv[3])
region = next((r for r in catalog["regions"] if r["code"] == code), None)
native = ((region or {}).get("source") or {}).get("nativeRegion")
if not native:
    sys.exit(f"{code} no se construye desde el catálogo nativo.")
print(native)
for item in catalog["regions"]:
    if (item.get("source") or {}).get("nativeRegion") != native:
        continue
    directory = item.get("mapDir") or item["code"]
    manifest = storage / "maps" / directory / f"{item['code']}.region.json"
    data = json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else {}
    print("map", item["code"], directory, data.get("mapChecksum") or "-")
    for asset in data.get("assets") or []:
        print("asset", item["code"], asset["file"], asset["checksum"])
PY
)"
PLAN="$(tr -d '\r' <<<"$PLAN")"  # Python on Windows ends its lines with CRLF
NATIVE="$(head -n 1 <<<"$PLAN")"
NATIVE_DIR="$STORAGE/imports/native/$NATIVE"
RUNTIME_FILES=(graph.bin graph.json search.ndjson build.json manifest.json climate-precipitation-regions.geojson)

# Fails unless a file of storage/ has the checksum its region's manifest recorded.
verify() {
  local file=$1 expected=$2 code=$3
  [[ -s "$STORAGE/$file" && "$(sha256sum "$STORAGE/$file" | cut -d' ' -f1)" == "$expected" ]] || {
    echo "$file no coincide con su manifiesto: ejecute 'region.sh manifest $code'." >&2
    exit 1
  }
}

FILES=()
READY=" "
while read -r kind code path expected; do
  case "$kind" in
    map)
      map="maps/$path/$code.pmtiles"
      [[ -s "$STORAGE/$map" && "$expected" != "-" ]] || continue
      verify "$map" "$expected" "$code"
      FILES+=("$map" "maps/$path/$code.region.json")
      READY+="$code "
      ;;
    asset)
      # Relief, satellite and overlays of a region that is published (its map line came first).
      [[ "$READY" == *" $code "* ]] || continue
      verify "maps/$path" "$expected" "$code"
      FILES+=("maps/$path")
      ;;
  esac
done < <(tail -n +2 <<<"$PLAN")
[[ ${#FILES[@]} -gt 0 ]] || {
  echo "No hay mapas preparados para $NATIVE." >&2
  exit 1
}
for file in "${RUNTIME_FILES[@]}"; do
  [[ -s "$NATIVE_DIR/$file" ]] || {
    echo "Falta $NATIVE_DIR/$file: ejecute 'region.sh build $REGION'." >&2
    exit 1
  }
  FILES+=("imports/native/$NATIVE/$file")
done

LIST="$(mktemp)"
trap 'rm -f "$LIST"' EXIT
for file in "${FILES[@]}"; do
  printf '%s  %s\n' "$(sha256sum "$STORAGE/$file" | cut -d' ' -f1)" "$file" >>"$LIST"
done
STAGING="$REMOTE_ROOT/storage/.publish-incoming"
echo "Copiando ${#FILES[@]} archivos a $HOST:$STAGING"
DIRS="$(printf '%s\n' "${FILES[@]}" | sed 's|/[^/]*$||' | sort -u | sed "s|^|'$STAGING/|; s|$|'|" | tr '\n' ' ')"
ssh "$HOST" "rm -rf '$STAGING' && mkdir -p $DIRS"
for file in "${FILES[@]}"; do
  scp -q "$STORAGE/$file" "$HOST:$STAGING/$file"
done
scp -q "$LIST" "$HOST:$STAGING/SHA256SUMS"

ssh "$HOST" "bash -s" -- "$REMOTE_ROOT" <<'REMOTE'
set -euo pipefail
ROOT=$1
STORAGE="$ROOT/storage"
STAGING="$STORAGE/.publish-incoming"
BACKUP="$STORAGE/.publish-backup"
cd "$STAGING"
sha256sum --quiet -c SHA256SUMS
sudo rm -rf "$BACKUP"
sudo mkdir -p "$BACKUP"
while read -r _ file; do
  if [[ -f "$STORAGE/$file" ]]; then
    sudo mkdir -p "$BACKUP/$(dirname "$file")"
    sudo cp -a "$STORAGE/$file" "$BACKUP/$file"
  fi
done <SHA256SUMS
# Data first, manifests last: a manifest never points at a file that is not in place yet.
for pass in data manifest; do
  while read -r _ file; do
    case "$file" in
      *.region.json) [[ $pass == manifest ]] || continue ;;
      *) [[ $pass == data ]] || continue ;;
    esac
    sudo mkdir -p "$STORAGE/$(dirname "$file")"
    sudo install -m 644 "$STAGING/$file" "$STORAGE/$file.publishing"
    sudo mv -f "$STORAGE/$file.publishing" "$STORAGE/$file"
  done <SHA256SUMS
done
cd "$ROOT"
rm -rf "$STAGING"
# This script arrives through stdin: commands that read it (docker compose exec) get /dev/null.
sudo docker compose restart backend </dev/null
for _ in $(seq 1 60); do
  if sudo docker compose exec -T backend node -e \
    "fetch('http://127.0.0.1:3000/health/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" \
    </dev/null >/dev/null 2>&1; then
    break
  fi
  sleep 3
done
sudo docker compose exec -T backend node dist/src/cli/sync-regions.js </dev/null
echo "Publicación completada. Archivos reemplazados en $BACKUP"
REMOTE
