#!/usr/bin/env bash
# Region data pipeline of the maps platform. Runs inside the data-tools image:
#
#   docker compose --profile tools run --rm data-tools <command> [region] [options]
#
# Commands
#   list                         regions of the catalog and what is already built
#   download <region>            download (or clip from its parent) the .osm.pbf
#   map <region>                 build the visual map (PMTiles) with tilegen
#   routing <region>             build the Valhalla routing graph
#   manifest <region>            write the manifest read by the backend
#   prepare <region>             download (if missing) + map + routing + manifest
#
# Options
#   --force-download             download again even if the extract exists
#   --skip-routing               prepare: only the visual map
#   --water-polygons             draw oceans with the OSMCoastline water polygons
#                                (~1 GB download, kept in storage/imports)
#
# Regions
#   Codes of infrastructure/regions/regions.json, or any Geofabrik extract id
#   (countries, states, continents: peru, colombia, spain, ...). "world" is the
#   world base map built from Natural Earth (low zooms, no routing), with the
#   index of countries and cities used by the place search.
#
# Files (Docker bind mounts of ./storage on the host)
#   /data/imports/<region>.osm.pbf           OpenStreetMap extract (input)
#   /data/imports/naturalearth/*.zip         Natural Earth shapefiles (world input)
#   /data/maps/<dir>/<region>.pmtiles        visual map, vector tiles
#   /data/maps/<dir>/<region>.region.json    manifest registered by the backend
#   /data/maps/world/world.places.json       countries and cities (world only)
#   /data/routing/<region>/                  Valhalla graph + <region>.valhalla.tar package
#
# Every output is written to a temporary file first and renamed when complete,
# so services never read half-written data.
set -euo pipefail

CATALOG="${REGIONS_CATALOG:-/etc/maps-platform/regions.json}"
IMPORTS_DIR="${IMPORTS_DIR:-/data/imports}"
MAPS_DIR="${MAPS_DIR:-/data/maps}"
ROUTING_DIR="${ROUTING_DIR:-/data/routing}"
TILEGEN_HOME="${TILEGEN_HOME:-/opt/tilegen}"
TILEGEN_MEMORY="${TILEGEN_MEMORY:-2g}"
TILEGEN_TMPDIR="${TILEGEN_TMPDIR:-/tmp}"
WATER_POLYGONS_URL="${WATER_POLYGONS_URL:-https://osmdata.openstreetmap.de/download/water-polygons-split-3857.zip}"
GEOFABRIK_INDEX_URL="${GEOFABRIK_INDEX_URL:-https://download.geofabrik.de/index-v1-nogeom.json}"
NATURAL_EARTH_URL="${NATURAL_EARTH_URL:-https://naciscdn.org/naturalearth/10m}"
# Natural Earth 10m layers of the world base map (public domain, ~45 MB), read
# by tilegen as /data/imports/naturalearth/<name>.zip.
NATURAL_EARTH_LAYERS=(
  physical/ne_10m_ocean
  physical/ne_10m_lakes
  physical/ne_10m_rivers_lake_centerlines
  physical/ne_10m_geography_marine_polys
  cultural/ne_10m_admin_0_countries
  cultural/ne_10m_admin_0_boundary_lines_land
  cultural/ne_10m_admin_1_states_provinces_lines
  cultural/ne_10m_populated_places
  cultural/ne_10m_roads
  cultural/ne_10m_urban_areas
)
# The world base map covers the low zooms; prepared regions add the detail.
WORLD_MAX_ZOOM=7
USER_AGENT="${DOWNLOAD_USER_AGENT:-maps-platform-data-tools/1.0}"
CODE_PATTERN='^[a-z0-9][a-z0-9-]{1,62}$'

export IMPORTS_DIR ROUTING_DIR

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() {
  log "ERROR: $*"
  exit 1
}

usage() {
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
  exit "${1:-0}"
}

# ------------------------------------------------------------------ catalog

region_json() {
  local code=$1
  [[ "$code" =~ $CODE_PATTERN ]] || die "invalid region code '$code'"
  jq -ce --arg code "$code" '.regions[] | select(.code == $code)' "$CATALOG" 2>/dev/null && return 0
  geofabrik_region "$code" ||
    die "region '$code' is neither in the catalog ($(jq -r '[.regions[].code] | join(", ")' "$CATALOG")) nor a Geofabrik extract id (https://download.geofabrik.de)"
}

# Any Geofabrik extract by its id (peru, colombia, spain, ...). The index is
# cached for a day in the imports folder.
geofabrik_region() {
  local code=$1 index="$IMPORTS_DIR/geofabrik-index.json"
  if [[ ! -s "$index" || -n "$(find "$index" -mmin +1440 2>/dev/null)" ]]; then
    mkdir -p "$IMPORTS_DIR"
    log "Downloading the Geofabrik index"
    curl --fail --silent --show-error --location --retry 3 --user-agent "$USER_AGENT" \
      --output "$index.part" "$GEOFABRIK_INDEX_URL" || return 1
    mv -f "$index.part" "$index"
  fi
  jq -ce --arg code "$code" '
    .features[].properties
    | select(.id == $code and .urls.pbf != null)
    | {code: .id, name: .name, country: ((.["iso3166-1:alpha2"] // [])[0] // "ZZ"),
       mapDir: (.parent // .id), source: {url: .urls.pbf}}' "$index"
}

field() { jq -r --arg name "$2" '.[$name] // empty' <<<"$1"; }

# True for the world base map (Natural Earth, no OSM extract, no routing).
is_natural_earth() { [[ $(jq -r '.source.naturalEarth // false' <<<"$1") == true ]]; }

map_dir() {
  local dir
  dir=$(field "$1" mapDir)
  echo "${dir:-$(field "$1" code)}"
}

# Gives new files the owner of the storage folder (the host user when ./storage
# is a bind mount) so they can be managed without root on the host.
match_owner() {
  local target=$1 reference=$2
  if [[ $(id -u) -eq 0 && -e "$target" && -e "$reference" ]]; then
    chown -R --reference="$reference" "$target"
  fi
}

# ------------------------------------------------------------------ download

download_pbf() {
  local url=$1 target=$2
  local part="$target.part" attempt
  for attempt in 1 2; do
    log "Downloading $url (attempt $attempt)"
    if ! curl --fail --location --retry 5 --retry-delay 10 --retry-connrefused \
      --continue-at - --user-agent "$USER_AGENT" --output "$part" "$url"; then
      # A finished .part (e.g. interrupted before the rename) makes the resume
      # request fail with 416; start from scratch once.
      log "Download failed, restarting from scratch"
      rm -f "$part"
      continue
    fi
    local expected actual
    expected=$(curl --fail --silent --location --user-agent "$USER_AGENT" "$url.md5" | awk '{print $1}') || expected=""
    if [[ -n "$expected" ]]; then
      actual=$(md5sum "$part" | awk '{print $1}')
      if [[ "$actual" != "$expected" ]]; then
        # The provider may have published a new extract while we were resuming.
        log "MD5 mismatch (expected $expected, got $actual); discarding the partial file"
        rm -f "$part"
        continue
      fi
      log "MD5 verified: $actual"
    else
      log "WARNING: $url.md5 is not available; only the PBF structure is verified"
    fi
    osmium fileinfo --input-format pbf "$part" >/dev/null || {
      rm -f "$part"
      die "$url is not a valid .osm.pbf file"
    }
    mv -f "$part" "$target"
    return 0
  done
  die "could not download a verified copy of $url"
}

download_natural_earth() {
  local force=$1 dir="$IMPORTS_DIR/naturalearth" layer name target
  mkdir -p "$dir"
  for layer in "${NATURAL_EARTH_LAYERS[@]}"; do
    name=${layer##*/}
    target="$dir/$name.zip"
    if [[ -s "$target" && "$force" != true ]]; then
      continue
    fi
    log "Downloading Natural Earth $name"
    curl --fail --silent --show-error --location --retry 5 --retry-delay 5 \
      --user-agent "$USER_AGENT" --output "$target.part" "$NATURAL_EARTH_URL/$layer.zip"
    unzip -tq "$target.part" >/dev/null || {
      rm -f "$target.part"
      die "$name.zip is corrupt"
    }
    mv -f "$target.part" "$target"
  done
  match_owner "$dir" "$IMPORTS_DIR"
  log "Natural Earth ready: $dir ($(du -sh "$dir" | cut -f1))"
}

cmd_download() {
  local code=$1 force=$2
  local region pbf url parent bbox
  region=$(region_json "$code")
  if is_natural_earth "$region"; then
    download_natural_earth "$force"
    return 0
  fi
  pbf="$IMPORTS_DIR/$code.osm.pbf"
  if [[ -s "$pbf" && "$force" != true ]]; then
    log "$pbf already exists (use --force-download to refresh it)"
    return 0
  fi
  mkdir -p "$IMPORTS_DIR"
  url=$(jq -r '.source.url // empty' <<<"$region")
  parent=$(jq -r '.source.parent // empty' <<<"$region")
  if [[ -n "$url" ]]; then
    download_pbf "$url" "$pbf"
  elif [[ -n "$parent" ]]; then
    bbox=$(jq -r '.bbox // empty | join(",")' <<<"$region")
    [[ -n "$bbox" ]] || die "region '$code' needs a bbox to be clipped from '$parent'"
    cmd_download "$parent" "$force"
    log "Clipping $code from $parent with bbox $bbox"
    osmium extract --bbox "$bbox" --set-bounds --overwrite --output-format pbf \
      --output "$pbf.part" "$IMPORTS_DIR/$parent.osm.pbf"
    mv -f "$pbf.part" "$pbf"
  else
    die "region '$code' has neither source.url nor source.parent"
  fi
  match_owner "$pbf" "$IMPORTS_DIR"
  log "Extract ready: $pbf ($(du -h "$pbf" | cut -f1))"
}

ensure_water_polygons() {
  local zip="$IMPORTS_DIR/water-polygons-split-3857.zip"
  if [[ -s "$zip" ]]; then
    echo "$zip"
    return 0
  fi
  log "Downloading ocean polygons (about 1 GB, only once): $WATER_POLYGONS_URL"
  curl --fail --location --retry 5 --retry-delay 10 --continue-at - \
    --user-agent "$USER_AGENT" --output "$zip.part" "$WATER_POLYGONS_URL"
  unzip -tq "$zip.part" >/dev/null || {
    rm -f "$zip.part"
    die "the water polygons archive is corrupt"
  }
  mv -f "$zip.part" "$zip"
  match_owner "$zip" "$IMPORTS_DIR"
  echo "$zip"
}

# ------------------------------------------------------------------ build steps

cmd_map() {
  local code=$1 water=$2
  local region pbf dir out tmp workdir places=""
  region=$(region_json "$code")
  dir="$MAPS_DIR/$(map_dir "$region")"
  out="$dir/$code.pmtiles"
  tmp="$dir/.$code.building.pmtiles"
  local args=(--name="$(field "$region" name)")
  if is_natural_earth "$region"; then
    [[ -s "$IMPORTS_DIR/naturalearth/ne_10m_ocean.zip" ]] || die "Natural Earth not found: run 'download $code' first"
    places="$dir/$code.places.json"
    args+=(--natural_earth="$IMPORTS_DIR/naturalearth" --gazetteer="$places.tmp" --maxzoom="$WORLD_MAX_ZOOM")
  else
    pbf="$IMPORTS_DIR/$code.osm.pbf"
    [[ -s "$pbf" ]] || die "$pbf not found: run 'download $code' first"
    args+=(--osm_path="$pbf")
    if [[ "$water" == true ]]; then
      args+=(--water_polygons="$(ensure_water_polygons)")
    fi
  fi
  mkdir -p "$dir"
  # Planetiler's scratch files live on the container filesystem: random I/O on
  # bind mounts from Windows/macOS hosts is very slow.
  mkdir -p "$TILEGEN_TMPDIR"
  workdir=$(mktemp -d "$TILEGEN_TMPDIR/tilegen-$code-XXXXXX")
  args+=(--output="$tmp" --tmpdir="$workdir")
  log "Building map tiles for $code"
  if ! java -Xmx"$TILEGEN_MEMORY" -jar "$TILEGEN_HOME/tilegen.jar" "${args[@]}" ${TILEGEN_ARGS:-}; then
    rm -rf "$workdir" "$tmp" ${places:+"$places.tmp"}
    die "tile generation failed for $code"
  fi
  rm -rf "$workdir"
  mv -f "$tmp" "$out"
  chmod 644 "$out"
  match_owner "$out" "$MAPS_DIR"
  if [[ -n "$places" ]]; then
    mv -f "$places.tmp" "$places"
    chmod 644 "$places"
    match_owner "$places" "$MAPS_DIR"
    log "Place index ready: $places ($(jq '.places | length' "$places") places)"
  fi
  match_owner "$dir" "$MAPS_DIR"
  log "Map ready: $out ($(du -h "$out" | cut -f1))"
}

cmd_routing() {
  local code=$1 region
  region=$(region_json "$code")
  if is_natural_earth "$region"; then
    die "$code is a base map: it has no routing graph"
  fi
  build-routing.sh "$code"
  match_owner "$ROUTING_DIR/$code" "$ROUTING_DIR"
}

# Reads zoom range and bounds from the PMTiles v3 header.
pmtiles_header() {
  local file=$1
  [[ "$(head -c 7 "$file")" == "PMTiles" ]] || die "$file is not a PMTiles archive"
  local zooms bounds
  zooms=$(od -An -tu1 -j100 -N2 "$file" | xargs)
  bounds=$(od -An -td4 -j102 -N16 --endian=little "$file" | xargs)
  jq -cn --arg zooms "$zooms" --arg bounds "$bounds" \
    '($zooms | split(" ") | map(tonumber)) as $z
     | ($bounds | split(" ") | map(tonumber / 10000000)) as $b
     | {minZoom: $z[0], maxZoom: $z[1], bbox: $b}'
}

cmd_manifest() {
  local code=$1
  local region dir map_rel map_file routing_rel routing_file header bbox version data_time manifest
  region=$(region_json "$code")
  dir=$(map_dir "$region")
  map_rel="$dir/$code.pmtiles"
  map_file="$MAPS_DIR/$map_rel"
  [[ -s "$map_file" ]] || die "$map_file not found: run 'map $code' first"
  routing_rel="$code/$code.valhalla.tar"
  routing_file="$ROUTING_DIR/$routing_rel"

  header=$(pmtiles_header "$map_file")
  bbox=$(jq -c '.bbox // empty' <<<"$region")
  [[ -n "$bbox" ]] || bbox=$(jq -c '.bbox' <<<"$header")
  version="${REGION_VERSION:-$(date -u +%Y.%m.%d.%H%M)}"
  data_time=""
  if [[ -s "$IMPORTS_DIR/$code.osm.pbf" ]]; then
    data_time=$(osmium fileinfo --no-progress -g header.option.osmosis_replication_timestamp \
      "$IMPORTS_DIR/$code.osm.pbf" 2>/dev/null || true)
  fi

  log "Computing checksums for $code"
  local map_sha routing_sha=""
  map_sha=$(sha256sum "$map_file" | cut -d' ' -f1)
  if [[ -s "$routing_file" ]]; then
    routing_sha=$(sha256sum "$routing_file" | cut -d' ' -f1)
  else
    log "No routing package for $code ($routing_file); the manifest only lists the map"
    routing_rel=""
  fi

  manifest="$MAPS_DIR/$dir/$code.region.json"
  jq -n \
    --argjson region "$region" --argjson header "$header" --argjson bbox "$bbox" \
    --arg version "$version" --arg mapFile "$map_rel" --arg mapChecksum "$map_sha" \
    --arg routingFile "$routing_rel" --arg routingChecksum "$routing_sha" \
    --arg dataTimestamp "$data_time" --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{
      code: $region.code, name: $region.name, country: $region.country,
      province: $region.province, city: $region.city,
      version: $version, bbox: $bbox,
      minZoom: $header.minZoom, maxZoom: $header.maxZoom,
      mapFile: $mapFile, mapChecksum: $mapChecksum,
      routingFile: (if $routingFile == "" then null else $routingFile end),
      routingChecksum: (if $routingChecksum == "" then null else $routingChecksum end),
      source: ($region.source.url // (if $region.source.parent then "clipped from " + $region.source.parent
               else "Natural Earth" end)),
      dataTimestamp: (if $dataTimestamp == "" then null else $dataTimestamp end),
      generatedAt: $generatedAt
    } | with_entries(select(.value != null))' >"$manifest.tmp"
  mv -f "$manifest.tmp" "$manifest"
  chmod 644 "$manifest"
  match_owner "$manifest" "$MAPS_DIR"
  log "Manifest written: $manifest (version $version)"
  cat "$manifest"
}

cmd_prepare() {
  local code=$1 force=$2 skip_routing=$3 water=$4
  local started=$SECONDS region
  region=$(region_json "$code")
  cmd_download "$code" "$force"
  cmd_map "$code" "$water"
  if [[ "$skip_routing" != true ]] && ! is_natural_earth "$region"; then
    cmd_routing "$code"
  fi
  cmd_manifest "$code" >/dev/null
  log "Region $code prepared in $((SECONDS - started)) s."
  log "Register it in the backend: make regions-sync (it is also picked up on backend start)."
}

cmd_list() {
  printf '%-12s %-24s %-8s %-8s %-8s %s\n' CODE NAME EXTRACT MAP ROUTING SOURCE
  jq -r '.regions[] | [.code, .name, (.mapDir // .code),
      (.source.url // (if .source.parent then "clip of " + .source.parent else "Natural Earth" end))] | @tsv' "$CATALOG" |
    while IFS=$'\t' read -r code name dir source; do
      local extract=no map=no routing=no
      [[ -s "$IMPORTS_DIR/$code.osm.pbf" ]] && extract=yes
      [[ "$source" == "Natural Earth" && -s "$IMPORTS_DIR/naturalearth/ne_10m_ocean.zip" ]] && extract=yes
      [[ -s "$MAPS_DIR/$dir/$code.pmtiles" ]] && map=yes
      [[ -s "$ROUTING_DIR/$code/valhalla.json" ]] && routing=yes
      printf '%-12s %-24s %-8s %-8s %-8s %s\n' "$code" "$name" "$extract" "$map" "$routing" "$source"
    done
  echo
  echo "Any Geofabrik extract id also works (peru, colombia, spain, ...): https://download.geofabrik.de"
}

# ------------------------------------------------------------------ main

main() {
  [[ $# -ge 1 ]] || usage 64
  local command=$1
  shift
  local code="" force=false skip_routing=false water=false
  while [[ $# -gt 0 ]]; do
    case "$1" in
    --force-download) force=true ;;
    --skip-routing) skip_routing=true ;;
    --water-polygons) water=true ;;
    -h | --help) usage 0 ;;
    -*) die "unknown option $1" ;;
    *)
      [[ -z "$code" ]] || die "only one region per command"
      code=$1
      ;;
    esac
    shift
  done
  case "$command" in
  list) cmd_list ;;
  download) cmd_download "${code:?region required}" "$force" ;;
  map) cmd_map "${code:?region required}" "$water" ;;
  routing) cmd_routing "${code:?region required}" ;;
  manifest) cmd_manifest "${code:?region required}" ;;
  prepare) cmd_prepare "${code:?region required}" "$force" "$skip_routing" "$water" ;;
  help | -h | --help) usage 0 ;;
  *) die "unknown command '$command' (see: help)" ;;
  esac
}

main "$@"
