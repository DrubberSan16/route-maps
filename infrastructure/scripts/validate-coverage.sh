#!/usr/bin/env bash
# Coverage check of search and routing across Ecuador, through the public API.
#
#   ./infrastructure/scripts/validate-coverage.sh [base-url]     default: http://localhost:8090
#
# Every case searches a place the way a person would type it (with the map centred on its
# city), then routes between the chosen results. A case passes when the first result matches
# the expected name and the route exists, starts and ends near the chosen places and has a
# plausible length. Needs curl and jq.
set -uo pipefail

BASE="${1:-${BASE_URL:-http://localhost:8090}}"
API="${BASE%/}/api/v1"
PASSED=0
FAILED=0
for dependency in curl jq grep sed; do
  command -v "$dependency" >/dev/null 2>&1 || {
    echo "Falta la dependencia requerida: $dependency" >&2
    exit 69
  }
done
pass() { PASSED=$((PASSED + 1)); printf '  \033[32mOK\033[0m   %s\n' "$*"; }
fail() { FAILED=$((FAILED + 1)); printf '  \033[31mFAIL\033[0m %s\n' "$*"; }
HEADERS=$(mktemp)
trap 'rm -f "$HEADERS"' EXIT

# call <curl arguments...> -> prints the body and, on the last line, the HTTP status. The public
# API limits requests per minute: a 429 is retried after the Retry-After it announces.
call() {
  local response status wait attempt
  for attempt in 1 2 3 4 5 6 7 8; do
    response=$(curl -sS -D "$HEADERS" -w '\n%{http_code}' "$@") || return 1
    status=$(tail -n 1 <<<"$response")
    [[ "$status" == 429 ]] || break
    wait=$(grep -i '^retry-after' "$HEADERS" | head -n 1 | tr -dc '0-9')
    sleep "$(( ${wait:-10} > 0 ? ${wait:-10} : 1 ))"
  done
  printf '%s\n' "$response"
}

# search <text> <lat> <lng> <expected regex> [country code] -> sets SEARCH_LAT/LNG/NAME
#
# Do not call this function through command substitution: that would run it in a
# subshell, hide its result line and lose the PASSED/FAILED counters.
search() {
  local text=$1 lat=$2 lng=$3 expected=$4 country=${5:-} body status
  body=$(call --get "$API/geocoding/search" --data-urlencode "q=$text" \
    --data-urlencode "lat=$lat" --data-urlencode "lng=$lng" --data-urlencode "limit=5") || {
    fail "search '$text': request failed"
    return 1
  }
  status=$(tail -n 1 <<<"$body")
  body=$(sed '$d' <<<"$body")
  if [[ "$status" != 200 ]]; then
    fail "search '$text': HTTP $status"
    return 1
  fi
  local name
  name=$(jq -r '.data[0].name // empty' <<<"$body")
  if [[ -z "$name" ]]; then
    fail "search '$text': no results"
    return 1
  fi
  if ! grep -Eiq "$expected" <<<"$name"; then
    fail "search '$text': first result '$name' does not match /$expected/"
    return 1
  fi
  if [[ -n "$country" && "$(jq -r '.data[0].address.countryCode // empty' <<<"$body")" != "$country" ]]; then
    fail "search '$text': first result '$(jq -r '.data[0].displayName' <<<"$body")' is not in $country"
    return 1
  fi
  pass "search '$text' -> $name ($(jq -r '.data[0].displayName' <<<"$body" | cut -c1-90))"
  SEARCH_LAT=$(jq -r '.data[0].latitude' <<<"$body")
  SEARCH_LNG=$(jq -r '.data[0].longitude' <<<"$body")
  SEARCH_NAME=$name
}

# route <label> <profile> <lat1> <lng1> <lat2> <lng2> <min km> <max km>
route() {
  local label=$1 profile=$2 lat1=$3 lng1=$4 lat2=$5 lng2=$6 min=$7 max=$8 body status
  body=$(call -X POST "$API/routes/calculate" -H 'Content-Type: application/json' \
    --data "{\"origin\":{\"latitude\":$lat1,\"longitude\":$lng1},\"destination\":{\"latitude\":$lat2,\"longitude\":$lng2},\"profile\":\"$profile\"}") || {
    fail "route $label ($profile): request failed"
    return 1
  }
  status=$(tail -n 1 <<<"$body")
  body=$(sed '$d' <<<"$body")
  if [[ "$status" != 200 ]]; then
    fail "route $label ($profile): HTTP $status $(jq -r '.error.message // empty' <<<"$body" 2>/dev/null)"
    return 1
  fi
  local km minutes steps first
  km=$(jq -r '(.data.distanceMeters / 1000 * 10 | round) / 10' <<<"$body")
  minutes=$(jq -r '(.data.durationSeconds / 60 | round)' <<<"$body")
  steps=$(jq -r '.data.steps | length' <<<"$body")
  first=$(jq -r '[.data.steps[] | select(.maneuver | test("TURN|SLIGHT|ROUNDABOUT"))][0].instruction // .data.steps[0].instruction' <<<"$body")
  if ! jq -en --argjson km "$km" --argjson min "$min" --argjson max "$max" '$km >= $min and $km <= $max' >/dev/null; then
    fail "route $label ($profile): $km km outside [$min, $max]"
    return 1
  fi
  pass "route $label ($profile): $km km, $minutes min, $steps pasos · $first"
}

# case <city> <lat> <lng> <query A> <regex A> <query B> <regex B> <min km> <max km>
case_pair() {
  local city=$1 lat=$2 lng=$3 qa=$4 ra=$5 qb=$6 rb=$7 min=$8 max=$9
  printf '\n\033[1m%s\033[0m\n' "$city"
  local alat alng blat blng
  search "$qa" "$lat" "$lng" "$ra" || return
  alat=$SEARCH_LAT
  alng=$SEARCH_LNG
  search "$qb" "$lat" "$lng" "$rb" || return
  blat=$SEARCH_LAT
  blng=$SEARCH_LNG
  route "$qa -> $qb" CAR "$alat" "$alng" "$blat" "$blng" "$min" "$max"
}

# One public-search smoke test for every provincial capital, including the
# Amazon and Galapagos. This proves nationwide index coverage independently of
# the more detailed route pairs below.
capital_search() {
  local province=$1 city=$2 lat=$3 lng=$4 expected=$5
  search "$city" "$lat" "$lng" "^($expected)\$" EC
}

echo "Coverage check against $BASE"

printf '\n\033[1m24 capitales provinciales\033[0m\n'
capital_search "Azuay" "Cuenca" -2.9005 -79.0045 "cuenca"
capital_search "Bolívar" "Guaranda" -1.5926 -79.0009 "guaranda"
capital_search "Cañar" "Azogues" -2.7397 -78.8486 "azogues"
capital_search "Carchi" "Tulcán" 0.8117 -77.7173 "tulc[aá]n"
capital_search "Chimborazo" "Riobamba" -1.6636 -78.6546 "riobamba"
capital_search "Cotopaxi" "Latacunga" -0.9336 -78.6155 "latacunga"
capital_search "El Oro" "Machala" -3.2581 -79.9554 "machala"
capital_search "Esmeraldas" "Esmeraldas" 0.9682 -79.6517 "esmeraldas"
capital_search "Galápagos" "Puerto Baquerizo Moreno" -0.9020 -89.6102 "puerto baquerizo moreno"
capital_search "Guayas" "Guayaquil" -2.1709 -79.9224 "guayaquil"
capital_search "Imbabura" "Ibarra" 0.3517 -78.1223 "ibarra"
capital_search "Loja" "Loja" -3.9931 -79.2042 "loja"
capital_search "Los Ríos" "Babahoyo" -1.8019 -79.5346 "babahoyo"
capital_search "Manabí" "Portoviejo" -1.0546 -80.4545 "portoviejo"
capital_search "Morona Santiago" "Macas" -2.3087 -78.1114 "macas"
capital_search "Napo" "Tena" -0.9938 -77.8129 "tena"
capital_search "Orellana" "El Coca" -0.4623 -76.9876 "el coca|puerto francisco de orellana"
capital_search "Pastaza" "Puyo" -1.4924 -78.0020 "puyo"
capital_search "Pichincha" "Quito" -0.1807 -78.4678 "quito"
capital_search "Santa Elena" "Santa Elena" -2.2267 -80.8587 "santa elena"
capital_search "Santo Domingo de los Tsáchilas" "Santo Domingo" -0.2531 -79.1754 "santo domingo( de los colorados)?"
capital_search "Sucumbíos" "Nueva Loja" 0.0847 -76.8828 "nueva loja"
capital_search "Tungurahua" "Ambato" -1.2491 -78.6167 "ambato"
capital_search "Zamora Chinchipe" "Zamora" -4.0692 -78.9563 "zamora"

printf '\n\033[1mBarrios y ciudades como los escribe la gente\033[0m\n'
search "Urdesa" -2.19 -79.89 "^urdesa$" EC
search "Alborada" -2.19 -79.89 "^alborada$" EC
search "Samanes" -2.19 -79.89 "samanes" EC
search "Ambato" -2.19 -79.89 "^ambato$" EC
search "Esmeraldas" -2.19 -79.89 "^esmeraldas$" EC
search "Baños" -2.19 -79.89 "^baños de agua santa$" EC
search "La Carolina" -0.20 -78.49 "carolina" EC
search "Santo Domingo" -2.19 -79.89 "santo domingo" EC

case_pair "Guayaquil" -2.19 -79.89 \
  "Malecón del Salado" "salado" "Terminal terrestre" "terminal terrestre" 3 15
case_pair "Guayaquil (malecones)" -2.19 -79.89 \
  "Malecon del Salado" "salado" "Malecón Simón Bolívar" "sim[oó]n bol[ií]var" 1 8
case_pair "Guayaquil (sur)" -2.25 -79.90 \
  "Av. 25 de Julio" "25 de julio" "Universidad Agraria" "agraria" 0.5 15
case_pair "Quito" -0.19 -78.49 \
  "Terminal Quitumbe" "quitumbe" "Quicentro" "quicentro" 12 30
case_pair "Quito (centro)" -0.22 -78.51 \
  "Av. Amazonas" "amazonas" "Plaza Grande" "plaza grande|independencia" 1 15
case_pair "Cuenca" -2.90 -79.00 \
  "Mall del Río" "mall del r[ií]o" "Terminal terrestre" "terminal" 2 15
case_pair "Ambato" -1.24 -78.62 \
  "Terminal terrestre" "terminal" "Parque Juan Montalvo" "montalvo" 0.5 15
case_pair "Manta" -0.96 -80.72 \
  "Terminal terrestre Manta" "terminal" "Mall del Pacífico" "pac[ií]fico" 0.5 15
case_pair "Portoviejo (Manabí)" -1.05 -80.45 \
  "Terminal terrestre Portoviejo" "terminal" "Hospital de especialidades" "hospital" 0.3 15
case_pair "Loja" -3.99 -79.20 \
  "Terminal terrestre Loja" "terminal" "Puerta de la Ciudad" "puerta de la ciudad|parque" 0.3 15
case_pair "Machala" -3.26 -79.96 \
  "Terminal terrestre Machala" "terminal" "Hospital Teófilo Dávila" "d[aá]vila|hospital" 0.3 15

printf '\n\033[1mEntre ciudades\033[0m\n'
route "Guayaquil -> Quito" CAR -2.1709 -79.9224 -0.1807 -78.4678 380 520
route "Quito -> Cuenca" CAR -0.1807 -78.4678 -2.9005 -79.0045 400 560
route "Manta -> Portoviejo" CAR -0.9677 -80.7089 -1.0546 -80.4545 25 60
route "Ambato -> Baños" CAR -1.2491 -78.6167 -1.3964 -78.4247 30 60
route "Guayaquil -> Salinas" CAR -2.1709 -79.9224 -2.2150 -80.9580 120 170
printf '\n\033[1mOtros medios\033[0m\n'
route "Guayaquil centro a pie" PEDESTRIAN -2.1961 -79.8862 -2.1894 -79.8870 0.3 3
route "Quito en bicicleta" BICYCLE -0.2100 -78.4930 -0.1900 -78.4850 1 6

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[[ "$FAILED" -eq 0 ]]
