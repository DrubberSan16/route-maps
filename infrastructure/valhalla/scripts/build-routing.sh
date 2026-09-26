#!/usr/bin/env bash
# Builds the Valhalla routing graph of a region. Runs inside the data-tools image
# (make build-routing REGION=<region>), never at service start.
#
# Input : /data/imports/<region>.osm.pbf
# Output: /data/routing/<region>/
#           valhalla.json            runtime config (used by the routing service)
#           <region>.valhalla.tar    graph tiles + index (routing package, also for devices)
#           admins.sqlite            admin areas (driving side, country access rules)
#
# The graph is built in ROUTING_BUILD_TMPDIR (the container's own filesystem by
# default: Valhalla writes thousands of small tile files, which is very slow on
# bind mounts from Windows/macOS hosts). Only the finished files are copied next
# to the output and swapped in atomically, so a running service never sees a
# half-written graph.
set -euo pipefail

REGION="${1:-${ROUTING_REGION:-}}"
if [[ -z "${REGION}" ]]; then
  echo "usage: build-routing.sh <region-code>" >&2
  exit 64
fi
if [[ ! "${REGION}" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]]; then
  echo "invalid region code: ${REGION}" >&2
  exit 64
fi

IMPORTS_DIR="${IMPORTS_DIR:-/data/imports}"
ROUTING_DIR="${ROUTING_DIR:-/data/routing}"
PBF="${IMPORTS_DIR}/${REGION}.osm.pbf"
OUT="${ROUTING_DIR}/${REGION}"
THREADS="${VALHALLA_BUILD_THREADS:-$(nproc)}"
BUILD_TMPDIR="${ROUTING_BUILD_TMPDIR:-/tmp}"

if [[ ! -s "${PBF}" ]]; then
  echo "[routing-builder] ${PBF} not found. Download it first: make download-region REGION=${REGION}" >&2
  exit 66
fi

mkdir -p "${ROUTING_DIR}" "${BUILD_TMPDIR}"
WORK="$(mktemp -d "${BUILD_TMPDIR}/valhalla-${REGION}-XXXXXX")"
STAGE=""
trap 'rm -rf "${WORK}" ${STAGE:+"${STAGE}"}' EXIT

echo "[routing-builder] Building Valhalla graph for ${REGION} from ${PBF} (${THREADS} threads)"

valhalla_build_config \
  --mjolnir-tile-dir "${WORK}/tiles" \
  --mjolnir-tile-extract "${WORK}/${REGION}.valhalla.tar" \
  --mjolnir-admin "${WORK}/admins.sqlite" \
  --mjolnir-timezone "${WORK}/timezones.sqlite" \
  --mjolnir-traffic-extract "${WORK}/traffic.tar" \
  --mjolnir-concurrency "${THREADS}" \
  > "${WORK}/build.json"

# Admin areas are optional: without them Valhalla assumes defaults.
if ! valhalla_build_admins -c "${WORK}/build.json" "${PBF}"; then
  echo "[routing-builder] WARNING: admin database could not be built; continuing without it" >&2
  rm -f "${WORK}/admins.sqlite"
fi

valhalla_build_tiles -c "${WORK}/build.json" "${PBF}"
valhalla_build_extract -c "${WORK}/build.json" -v
rm -rf "${WORK}/tiles"

# Runtime config pointing at the final location of the files.
valhalla_build_config \
  --mjolnir-tile-dir "${OUT}/tiles" \
  --mjolnir-tile-extract "${OUT}/${REGION}.valhalla.tar" \
  --mjolnir-admin "${OUT}/admins.sqlite" \
  --mjolnir-timezone "${OUT}/timezones.sqlite" \
  --mjolnir-traffic-extract "${OUT}/traffic.tar" \
  --mjolnir-concurrency "${THREADS}" \
  > "${WORK}/valhalla.json"
rm -f "${WORK}/build.json"
date -u +%Y-%m-%dT%H:%M:%SZ > "${WORK}/BUILT_AT"

# Copy the finished files next to the output (same filesystem), then swap the
# previous graph out atomically.
STAGE="$(mktemp -d "${ROUTING_DIR}/.build-${REGION}-XXXXXX")"
cp -a "${WORK}/." "${STAGE}/"
if [[ -d "${OUT}" ]]; then
  mv "${OUT}" "${OUT}.previous"
fi
mv "${STAGE}" "${OUT}"
STAGE=""
rm -rf "${OUT}.previous"
chmod -R a+rX "${OUT}"

echo "[routing-builder] Done: $(du -sh "${OUT}/${REGION}.valhalla.tar" | cut -f1) -> ${OUT}"
echo "[routing-builder] Restart the routing service if it serves this region: docker compose restart routing"
