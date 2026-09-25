#!/usr/bin/env bash
# Entry point of the routing service. It only serves an already built graph:
# graph generation is a separate, explicit step (build-routing.sh).
set -euo pipefail

REGION="${ROUTING_REGION:?ROUTING_REGION must be set (e.g. guayaquil)}"
CONFIG="${ROUTING_DIR:-/data/routing}/${REGION}/valhalla.json"
THREADS="${VALHALLA_SERVER_THREADS:-2}"

until [[ -s "${CONFIG}" ]]; do
  echo "[routing] No routing graph for '${REGION}' yet (${CONFIG})."
  echo "[routing] Prepare it with: make prepare-region REGION=${REGION}  (or: make build-routing REGION=${REGION})"
  sleep 30
done

echo "[routing] Serving Valhalla graph '${REGION}' with ${THREADS} threads on :8002"
exec valhalla_service "${CONFIG}" "${THREADS}"
