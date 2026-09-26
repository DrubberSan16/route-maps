#!/usr/bin/env bash
# End-to-end smoke test of a running stack, through Nginx (the only public entry point).
#
#   ./infrastructure/scripts/smoke-test.sh [base-url]        default: http://localhost:8080
#   REGION=guayaquil ./infrastructure/scripts/smoke-test.sh  test a specific region
#
# Checks health, auth (register, login, me, refresh rotation, logout), map
# regions (list, detail, version, resumable downloads with checksum), PMTiles
# Range requests, style and glyphs, routing with every profile, trips +
# tracking, offline sync (push, idempotent retry, pull), geocoding and the web
# viewer. Needs curl, jq and sha256sum; at least one region must be prepared
# (make prepare-region REGION=...).
set -uo pipefail

BASE="${1:-${BASE_URL:-http://localhost:8080}}"
BASE="${BASE%/}"
API="$BASE/api/v1"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASSED=0
FAILED=0
pass() { PASSED=$((PASSED + 1)); printf '  \033[32mOK\033[0m   %s\n' "$*"; }
fail() { FAILED=$((FAILED + 1)); printf '  \033[31mFAIL\033[0m %s\n' "$*"; }
section() { printf '\n\033[1m%s\033[0m\n' "$*"; }
# expect <description> <command...>: passes when the command succeeds.
expect() {
  local description=$1
  shift
  if "$@" >/dev/null 2>&1; then pass "$description"; else fail "$description"; fi
}

# http <method> <path-or-url> [json-body] [extra curl args...]
# Writes the body to $WORK/body and prints the HTTP status.
http() {
  local method=$1 target=$2 body=${3:-}
  shift 3 2>/dev/null || shift $#
  [[ "$target" == http* ]] || target="$API$target"
  local args=(-sS -o "$WORK/body" -D "$WORK/headers" -w '%{http_code}' -X "$method" "$target")
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' --data "$body")
  [[ -n "${TOKEN:-}" ]] && args+=(-H "Authorization: Bearer $TOKEN")
  curl "${args[@]}" "$@" || echo 000
}
json() { jq -r "$1" "$WORK/body" 2>/dev/null; }
header() { grep -i "^$1:" "$WORK/headers" | head -n 1 | cut -d' ' -f2- | tr -d '\r'; }

for tool in curl jq sha256sum; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 2; }
done
echo "Smoke test against $BASE"

# ------------------------------------------------------------------ health
section "Health"
expect "Nginx answers /nginx-health" test "$(curl -fsS "$BASE/nginx-health")" = ok
status=$(http GET "$BASE/health")
expect "GET /health -> 200 ($(json .status))" test "$status" = 200
expect "database is up" test "$(json .services.database)" = up
expect "routing engine is up" test "$(json .services.routing)" = up
redis_state=$(json .services.redis)
[[ "$redis_state" == up ]] && pass "redis is up" || fail "redis is $redis_state"

# ------------------------------------------------------------------ auth
section "Auth (JWT access + refresh)"
EMAIL="smoke-$(date +%s)-$RANDOM@example.com"
PASSWORD="Smoke-Test-$RANDOM-Pass!"
status=$(http POST /auth/register "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Smoke Test\"}")
expect "register -> 201" test "$status" = 201
status=$(http POST /auth/register "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Smoke Test\"}")
expect "duplicate email -> 409 EMAIL_ALREADY_REGISTERED" test "$status:$(json .error.code)" = "409:EMAIL_ALREADY_REGISTERED"
status=$(http POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"wrong-password\"}")
expect "wrong password -> 401 INVALID_CREDENTIALS" test "$status:$(json .error.code)" = "401:INVALID_CREDENTIALS"
status=$(http POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
expect "login -> 200" test "$status" = 200
ACCESS=$(json .data.accessToken)
REFRESH=$(json .data.refreshToken)
status=$(http GET /auth/me)
expect "GET /auth/me without token -> 401 UNAUTHORIZED" test "$status:$(json .error.code)" = "401:UNAUTHORIZED"
TOKEN=$ACCESS
status=$(http GET /auth/me)
expect "GET /auth/me with the access token -> $EMAIL" test "$status:$(json .data.email)" = "200:$EMAIL"
TOKEN=
status=$(http POST /auth/refresh "{\"refreshToken\":\"$REFRESH\"}")
expect "refresh -> 200 with new tokens" test "$status" = 200
NEW_REFRESH=$(json .data.refreshToken)
ACCESS=$(json .data.accessToken)
status=$(http POST /auth/refresh "{\"refreshToken\":\"$REFRESH\"}")
expect "re-using a rotated refresh token -> 401" test "$status" = 401
# Re-use detection revokes the whole session family: log in again.
http POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" >/dev/null
ACCESS=$(json .data.accessToken)
REFRESH=$(json .data.refreshToken)
TOKEN=$ACCESS

# ------------------------------------------------------------------ regions
section "Map regions"
status=$(http GET /maps/regions)
expect "GET /maps/regions -> 200" test "$status" = 200
count=$(json '.data | length')
if [[ "${count:-0}" -lt 1 ]]; then
  fail "no prepared regions: run make prepare-region REGION=<region> first"
  printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
  exit 1
fi
# The world base map has no routing package: test a prepared region.
REGION="${REGION:-$(json '([.data[] | select(.id != "world")][0].id) // .data[0].id')}"
pass "$count region(s) available, testing '$REGION'"
status=$(http GET "/maps/regions/$REGION")
expect "GET /maps/regions/$REGION -> 200" test "$status" = 200
cp "$WORK/body" "$WORK/region.json"
region() { jq -r "$1" "$WORK/region.json"; }
CHECKSUM=$(region .data.checksum)
MAP_SIZE=$(region .data.mapSize)
expect "checksum is a SHA-256 ($CHECKSUM)" grep -Eq '^[0-9a-f]{64}$' <<<"$CHECKSUM"
expect "mapSize > 0 ($MAP_SIZE bytes)" test "$MAP_SIZE" -gt 0
expect "mapDownloadUrl is $(region .data.mapDownloadUrl)" test "$(region .data.mapDownloadUrl)" = "/api/v1/maps/regions/$REGION/download"
status=$(http GET "/maps/regions/does-not-exist")
expect "unknown region -> 404 MAP_REGION_NOT_FOUND" test "$status:$(json .error.code)" = "404:MAP_REGION_NOT_FOUND"
status=$(http GET "/maps/regions/$REGION/version?localVersion=2000.01")
expect "old local version -> updateAvailable=true" test "$status:$(json .data.updateAvailable)" = "200:true"
status=$(http GET "/maps/regions/$REGION/version?localVersion=$(region .data.version)")
expect "current local version -> updateAvailable=false" test "$status:$(json .data.updateAvailable)" = "200:false"

MIN_LNG=$(region '.data.bbox[0]')
MIN_LAT=$(region '.data.bbox[1]')
MAX_LNG=$(region '.data.bbox[2]')
MAX_LAT=$(region '.data.bbox[3]')
CENTER_LAT=$(jq -n "($MIN_LAT + $MAX_LAT) / 2")
CENTER_LNG=$(jq -n "($MIN_LNG + $MAX_LNG) / 2")
status=$(http GET "/maps/regions/locate?lat=$CENTER_LAT&lng=$CENTER_LNG")
expect "locate($CENTER_LAT, $CENTER_LNG) finds $REGION" test "$(jq -r --arg r "$REGION" '[.data[].id] | index($r) != null' "$WORK/body")" = true

section "Resumable downloads (served by Nginx via X-Accel-Redirect)"
status=$(http GET "/maps/regions/$REGION/download" "" -H 'Range: bytes=0-6')
expect "map download with Range -> 206" test "$status" = 206
expect "starts with the PMTiles magic number" test "$(head -c 7 "$WORK/body")" = PMTiles
expect "Content-Range bytes 0-6/$MAP_SIZE" test "$(header Content-Range)" = "bytes 0-6/$MAP_SIZE"
expect "X-Checksum-Sha256 header matches the catalog" test "$(header X-Checksum-Sha256)" = "$CHECKSUM"
expect "Accept-Ranges: bytes" test "$(header Accept-Ranges)" = bytes
status=$(http HEAD "/maps/regions/$REGION/download" "" -I)
expect "HEAD -> 200 with Content-Length $MAP_SIZE" test "$status:$(header Content-Length)" = "200:$MAP_SIZE"
if [[ "$MAP_SIZE" -le $((200 * 1024 * 1024)) ]]; then
  # Resume: first half then the rest, like the mobile download manager.
  half=$((MAP_SIZE / 2))
  curl -sS -o "$WORK/part1" -H "Range: bytes=0-$((half - 1))" "$API/maps/regions/$REGION/download"
  curl -sS -o "$WORK/part2" -H "Range: bytes=$half-" "$API/maps/regions/$REGION/download"
  cat "$WORK/part1" "$WORK/part2" >"$WORK/map.pmtiles"
  expect "resumed download (2 ranges) matches the SHA-256" test "$(sha256sum "$WORK/map.pmtiles" | cut -d' ' -f1)" = "$CHECKSUM"
fi
if [[ "$(region .data.routingDownloadUrl)" != null ]]; then
  status=$(http GET "/maps/regions/$REGION/routing/download" "" -H 'Range: bytes=0-99')
  expect "routing package download with Range -> 206" test "$status" = 206
  expect "routing X-Checksum-Sha256 matches the catalog" test "$(header X-Checksum-Sha256)" = "$(region .data.routingChecksum)"
fi

section "PMTiles for online rendering (/maps/*, Range requests)"
TILES_URL="$BASE$(region .data.tilesUrl)"
status=$(http GET "$TILES_URL" "" -H 'Range: bytes=0-126' -H 'Origin: https://example.com')
expect "GET $(region .data.tilesUrl) with Range -> 206" test "$status" = 206
expect "PMTiles v3 header" test "$(head -c 7 "$WORK/body")" = PMTiles
expect "CORS: Access-Control-Allow-Origin *" test "$(header Access-Control-Allow-Origin)" = '*'
expect "Content-Range exposed to browsers" grep -qi 'Content-Range' <<<"$(header Access-Control-Expose-Headers)"
status=$(http OPTIONS "$TILES_URL" "" -H 'Origin: https://example.com' -H 'Access-Control-Request-Headers: range')
expect "CORS preflight -> 204" test "$status" = 204
status=$(http GET "$BASE/maps/style/style.json")
expect "style.json -> 200 ($(json '.layers | length') layers)" test "$status" = 200
expect "style attributes OpenStreetMap" grep -q 'OpenStreetMap contributors' "$WORK/body"
status=$(http GET "$BASE/maps/fonts/Noto%20Sans%20Regular/0-255.pbf")
expect "glyphs Noto Sans Regular 0-255 -> 200" test "$status" = 200
status=$(http GET "$BASE/maps/$REGION.region.json")
expect "manifests are not public (/maps/*.region.json -> 404)" test "$status" = 404

# ------------------------------------------------------------------ routing
section "Routing (POST /api/v1/routes/calculate)"
# Two points on the bbox diagonal (40% and 60%); the engine snaps them to roads.
O_LAT=$(jq -n "$MIN_LAT + ($MAX_LAT - $MIN_LAT) * 0.4")
O_LNG=$(jq -n "$MIN_LNG + ($MAX_LNG - $MIN_LNG) * 0.4")
D_LAT=$(jq -n "$MIN_LAT + ($MAX_LAT - $MIN_LAT) * 0.6")
D_LNG=$(jq -n "$MIN_LNG + ($MAX_LNG - $MIN_LNG) * 0.6")
ROUTE_POINTS="\"origin\":{\"latitude\":$O_LAT,\"longitude\":$O_LNG},\"destination\":{\"latitude\":$D_LAT,\"longitude\":$D_LNG}"
for profile in CAR TRUCK MOTORCYCLE BICYCLE PEDESTRIAN; do
  status=$(http POST /routes/calculate "{$ROUTE_POINTS,\"profile\":\"$profile\",\"alternatives\":true}")
  if [[ "$status" == 200 && "$(json '.data.geometry.coordinates | length')" -ge 2 ]]; then
    pass "$profile: $(json .data.distanceMeters) m, $(json .data.durationSeconds) s, $(json '.data.steps | length') steps, $(json '.data.routes | length') route(s) [$(json '.data.steps[0].instruction')]"
    [[ "$profile" == CAR ]] && cp "$WORK/body" "$WORK/route.json"
  else
    fail "$profile: HTTP $status $(json .error.code) $(json .error.message)"
  fi
done
status=$(http POST /routes/calculate '{"origin":{"latitude":95,"longitude":0},"destination":{"latitude":1,"longitude":1},"profile":"CAR"}')
expect "latitude 95 -> 400" test "$status" = 400
status=$(http POST /routes/calculate "{$ROUTE_POINTS,\"profile\":\"PLANE\"}")
expect "unknown profile -> 400 VALIDATION_ERROR" test "$status:$(json .error.code)" = "400:VALIDATION_ERROR"

if [[ -s "$WORK/route.json" ]]; then
  SAVE_BODY=$(jq -c '.data | {name: "Smoke route", profile, origin: {latitude: .geometry.coordinates[0][1], longitude: .geometry.coordinates[0][0]}, destination: {latitude: .geometry.coordinates[-1][1], longitude: .geometry.coordinates[-1][0]}, distanceMeters, durationSeconds, geometry, steps}' "$WORK/route.json")
  status=$(http POST /routes "$SAVE_BODY")
  expect "save the calculated route -> 201" test "$status" = 201
  ROUTE_ID=$(json .data.id)
  status=$(http GET "/routes/$ROUTE_ID")
  expect "GET saved route with geometry" test "$status:$(json '.data.geometry.type')" = "200:LineString"
fi

# ------------------------------------------------------------------ trips, tracking, sync
section "Trips, tracking and offline sync"
now() { date -u +%Y-%m-%dT%H:%M:%S.000Z; }
# ISO timestamp N seconds ago (GNU date or BusyBox/BSD fallback through jq).
ago() { jq -nr --argjson s "$1" '(now - $s) | strftime("%Y-%m-%dT%H:%M:%S.000Z")'; }
status=$(http POST /trips "{\"profile\":\"CAR\",\"name\":\"Smoke trip\"}")
expect "start trip -> 201" test "$status" = 201
TRIP_ID=$(json .data.id)
status=$(http POST /tracking/location "{\"tripId\":\"$TRIP_ID\",\"latitude\":$O_LAT,\"longitude\":$O_LNG,\"accuracy\":8.4,\"speed\":36.5,\"heading\":180,\"timestamp\":\"$(now)\"}")
expect "POST /tracking/location -> 201" test "$status" = 201

SYNC_TRIP=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr 'A-Z' 'a-z')
OP1="op-$RANDOM-$RANDOM-1"
OP2="op-$RANDOM-$RANDOM-2"
OP3="op-$RANDOM-$RANDOM-3"
PUSH="{\"installationId\":\"smoke-device-$RANDOM\",\"operations\":[
  {\"id\":\"$OP1\",\"entity\":\"trip\",\"operation\":\"CREATE\",\"payload\":{\"id\":\"$SYNC_TRIP\",\"profile\":\"CAR\",\"startedAt\":\"$(ago 120)\"}},
  {\"id\":\"$OP2\",\"entity\":\"tracking_point\",\"operation\":\"CREATE\",\"payload\":{\"points\":[
    {\"tripId\":\"$SYNC_TRIP\",\"latitude\":$O_LAT,\"longitude\":$O_LNG,\"accuracy\":5,\"timestamp\":\"$(ago 90)\"},
    {\"tripId\":\"$SYNC_TRIP\",\"latitude\":$D_LAT,\"longitude\":$D_LNG,\"accuracy\":5,\"timestamp\":\"$(ago 30)\"}]}},
  {\"id\":\"$OP3\",\"entity\":\"trip\",\"operation\":\"FINISH\",\"payload\":{\"id\":\"$SYNC_TRIP\"}}]}"
status=$(http POST /sync/push "$PUSH")
expect "sync push -> 200, 3 operations APPLIED" test "$status:$(json '[.data.results[].status] | join(",")')" = "200:APPLIED,APPLIED,APPLIED"
status=$(http POST /sync/push "$PUSH")
expect "retrying the same push is idempotent (DUPLICATE)" test "$(json '[.data.results[].status] | unique | join(",")')" = DUPLICATE
status=$(http GET "/trips/$SYNC_TRIP")
expect "synced trip is COMPLETED with 2 points and distance > 0 ($(json .data.distanceMeters) m)" test "$(json .data.status):$(json .data.pointCount):$(json '.data.distanceMeters > 0')" = "COMPLETED:2:true"
status=$(http GET "/sync/pull?since=2000-01-01T00:00:00.000Z")
expect "sync pull returns the saved routes" test "$status:$(json '.data.routes | length >= 1')" = "200:true"

# ------------------------------------------------------------------ geocoding, docs, viewer
section "Geocoding, Swagger and viewer"
# Nominatim (addresses, reverse geocoding) is optional; the world base map adds a
# search of countries and cities that works without it.
geocoding_state=$(curl -fsS "$BASE/health" | jq -r '.services.geocoding' 2>/dev/null)
status=$(http GET "/geocoding/search?q=hospital")
if [[ "$geocoding_state" != up && "$status" == 200 ]]; then
  pass "place search without Nominatim (world base map) -> 200"
  status=$(http GET "/geocoding/search?q=Quito")
  expect "world place search finds Quito" test "$status:$(json '[.data[].name] | index("Quito") != null')" = "200:true"
elif [[ "$status" == 200 ]]; then
  pass "geocoding search -> 200 ($(json '.data | length') results)"
  if [[ -s "$WORK/route.json" ]]; then
    # The first point of the calculated route lies on a street.
    R_LNG=$(jq -r '.data.geometry.coordinates[0][0]' "$WORK/route.json")
    R_LAT=$(jq -r '.data.geometry.coordinates[0][1]' "$WORK/route.json")
    status=$(http GET "/geocoding/reverse?lat=$R_LAT&lng=$R_LNG")
    expect "reverse geocoding of the route start -> $(json .data.displayName)" \
      test "$status:$(json '.data.displayName | length > 0')" = "200:true"
  fi
else
  expect "geocoding disabled -> 503 GEOCODING_PROVIDER_UNAVAILABLE" test "$status:$(json .error.code)" = "503:GEOCODING_PROVIDER_UNAVAILABLE"
fi
status=$(http GET "$BASE/api/docs")
[[ "$status" == 200 ]] && pass "Swagger UI at /api/docs" || pass "Swagger disabled (HTTP $status)"
status=$(http GET "$BASE/")
expect "web viewer -> 200" test "$status" = 200
status=$(http GET "$BASE/vendor/maplibre-gl.mjs")
expect "viewer bundles MapLibre GL JS locally" test "$status" = 200
status=$(http GET "$BASE/vendor/fonts/inter-latin-wght-normal.woff2")
expect "viewer bundles its font locally" test "$status" = 200

status=$(http POST /auth/logout "{\"refreshToken\":\"$REFRESH\"}")
expect "logout -> 200" test "$status" = 200
status=$(http POST /auth/refresh "{\"refreshToken\":\"$REFRESH\"}")
expect "refresh after logout -> 401" test "$status" = 401

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[[ "$FAILED" -eq 0 ]]
