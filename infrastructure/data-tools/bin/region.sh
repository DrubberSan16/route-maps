#!/usr/bin/env bash
# Region data pipeline of the maps platform. Runs inside the data-tools image:
#
#   docker compose --profile tools run --rm data-tools <command> [region] [options]
#
# Commands
#   list                         regions of the catalog and what is already built
#   download <region>            download the audited sources required by the region
#   build <region>               road graph, search index and map layers from the sources
#   aliases <region>             apply neighbourhood groups and popular names (no geometry rebuild)
#   map <region>                 build the visual map (PMTiles) with tilegen
#   rasters <region>             relief and satellite layers (raster PMTiles, see raster-data)
#   pack <region>                offline pack of the mobile app: roads and search index of the
#                                region, for routes and address search without connection
#   routing <region>             legacy Valhalla graph (OSM regions only)
#   manifest <region>            write the manifest read by the backend
#   prepare <region>             download (if missing) + build + map + rasters + pack + manifest
#   source-version <region>      print the upstream data fingerprint
#
# Options
#   --force-download             download again even if the extract exists
#   --skip-routing               prepare: without the offline pack of the phone (only the map)
#   --skip-rasters               prepare: without the relief and satellite layers
#   --water-polygons             draw oceans with the OSMCoastline water polygons
#                                (~1 GB download, kept in storage/imports)
#
# Regions
#   Codes of infrastructure/regions/regions.json. "world" is the
#   world base map built from Natural Earth (low zooms, no routing), with the
#   index of countries and cities used by the place search.
#
# Files (Docker bind mounts of ./storage on the host)
#   /data/imports/native/<region>/*.geojson  audited official/public inputs and the map layers
#   /data/imports/native/<region>/inec/      census cartography cache (one folder per province)
#   /data/imports/native/<region>/graph.bin  road graph read by the backend (routing, reverse geocoding)
#   /data/imports/native/<region>/search.ndjson  search index read by the backend
#   /data/imports/naturalearth/*.zip         Natural Earth shapefiles (world input)
#   /data/imports/raster/                    elevation tiles and satellite composites (raster layers)
#   /data/maps/<dir>/<region>.pmtiles        visual map, vector tiles
#   /data/maps/<dir>/<region>.overlays.pmtiles   population and climate (hidden until shown)
#   /data/maps/<dir>/<region>.terrain.pmtiles    relief: elevation tiles (Terrarium, WebP)
#   /data/maps/<dir>/<region>.satellite.pmtiles  satellite view: colour tiles (WebP)
#   /data/maps/<dir>/<region>.region.json    manifest registered by the backend
#   /data/maps/world/world.places.json       countries and cities (world only)
#   /data/routing/<region>/<region>.rmpack   offline pack of the phone (roads and search index)
#   /data/routing/<region>/                  legacy OSM regions: Valhalla graph + <region>.valhalla.tar
#
# Every output is written to a temporary file first and renamed when complete,
# so services never read half-written data.
set -euo pipefail

CATALOG="${REGIONS_CATALOG:-/etc/maps-platform/regions.json}"
IMPORTS_DIR="${IMPORTS_DIR:-/data/imports}"
MAPS_DIR="${MAPS_DIR:-/data/maps}"
ROUTING_DIR="${ROUTING_DIR:-/data/routing}"
# Kilometres around the region kept in its offline pack (routes that leave the region a little).
PACK_MARGIN_KM="${PACK_MARGIN_KM:-5}"
# Extra archives a region may have next to its map, listed in the manifest as its assets.
ASSET_KINDS=(terrain satellite overlays)
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

export IMPORTS_DIR ROUTING_DIR MAPS_DIR

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
  die "region '$code' is not in the audited catalog ($(jq -r '[.regions[].code] | join(", ")' "$CATALOG"))"
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
is_native() { [[ -n $(jq -r '.source.nativeRegion // empty' <<<"$1") ]]; }

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
  if is_native "$region"; then
    local native_region
    native_region=$(jq -r '.source.nativeRegion' <<<"$region")
    local native_args=(download "$native_region")
    [[ "$force" == true ]] && native_args+=(--force)
    native-data "${native_args[@]}"
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

# A stable upstream fingerprint used by the unattended refresh job. Regions
# clipped from a parent inherit the parent's fingerprint plus their bbox. The
# world base map is deliberately manual: Natural Earth publishes several files
# without one atomic release checksum.
cmd_source_version() {
  local code=$1 region url parent bbox expected headers etag modified
  region=$(region_json "$code")
  if is_natural_earth "$region"; then
    echo "natural-earth:manual"
    return 0
  fi
  if is_native "$region"; then
    local native_region manifest
    native_region=$(jq -r '.source.nativeRegion' <<<"$region")
    manifest="$IMPORTS_DIR/native/$native_region/manifest.json"
    [[ -s "$manifest" ]] || die "native source manifest not found: run 'download $code' first"
    jq -Sc '[.layers[] | {id, sha256}] | sort_by(.id)' "$manifest" |
      sha256sum | awk '{print "native-layers:" $1}'
    return 0
  fi
  url=$(jq -r '.source.url // empty' <<<"$region")
  parent=$(jq -r '.source.parent // empty' <<<"$region")
  if [[ -n "$parent" ]]; then
    bbox=$(jq -c '.bbox' <<<"$region")
    echo "clip:$parent:$bbox:$(cmd_source_version "$parent")"
    return 0
  fi
  [[ -n "$url" ]] || die "region '$code' has no upstream source"
  expected=$(curl --fail --silent --location --retry 3 --user-agent "$USER_AGENT" "$url.md5" |
    awk 'NR == 1 { print tolower($1) }') || expected=""
  if [[ "$expected" =~ ^[0-9a-f]{32}$ ]]; then
    echo "md5:$expected"
    return 0
  fi
  headers=$(curl --fail --silent --show-error --location --head --retry 3 \
    --user-agent "$USER_AGENT" "$url") || die "could not read source metadata for $url"
  etag=$(awk 'BEGIN{IGNORECASE=1} /^etag:/ {sub(/^[^:]*:[[:space:]]*/, ""); gsub(/\r/, ""); print; exit}' <<<"$headers")
  modified=$(awk 'BEGIN{IGNORECASE=1} /^last-modified:/ {sub(/^[^:]*:[[:space:]]*/, ""); gsub(/\r/, ""); print; exit}' <<<"$headers")
  [[ -n "$etag$modified" ]] || die "source $url exposes neither MD5, ETag nor Last-Modified"
  echo "http:etag=$etag:last-modified=$modified"
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

# Runs tilegen with the given arguments, writing to $1. Planetiler's scratch files live on the
# container filesystem: random I/O on bind mounts from Windows/macOS hosts is very slow.
run_tilegen() {
  local output=$1 workdir status=0
  shift
  mkdir -p "$TILEGEN_TMPDIR"
  workdir=$(mktemp -d "$TILEGEN_TMPDIR/tilegen-XXXXXX")
  # shellcheck disable=SC2086 # TILEGEN_ARGS holds several options
  java -Xmx"$TILEGEN_MEMORY" -jar "$TILEGEN_HOME/tilegen.jar" "$@" --output="$output" --tmpdir="$workdir" \
    ${TILEGEN_ARGS:-} || status=$?
  rm -rf "$workdir"
  return "$status"
}

# Population and climate of a native map, in <region>.overlays.pmtiles: the clients show them only
# on demand, so they are read only then instead of weighing on every map tile. Up to zoom 12, the
# last level with overlay features (the clients enlarge it further in).
build_overlays() {
  local code=$1 dir=$2 data=$3 out tmp
  shift 3
  out="$dir/$code.overlays.pmtiles"
  tmp="$dir/.$code.overlays.building.pmtiles"
  if [[ ! -s "$data/map-population.geojson" && ! -s "$data/climate-precipitation-regions.geojson" &&
        ! -s "$data/climate-temperature-regions.geojson" ]]; then
    rm -f "$out"
    log "No population or climate layers for $code: no overlays archive"
    return 0
  fi
  log "Building overlay tiles for $code"
  if ! run_tilegen "$tmp" --native_data="$data" --native_layers=overlays --maxzoom=12 "$@"; then
    rm -f "$tmp"
    die "overlay tile generation failed for $code"
  fi
  mv -f "$tmp" "$out"
  chmod 644 "$out"
  match_owner "$out" "$MAPS_DIR"
  log "Overlays ready: $out ($(du -h "$out" | cut -f1))"
}

cmd_map() {
  local code=$1 water=$2
  local region pbf dir out tmp places="" native_data=""
  region=$(region_json "$code")
  dir="$MAPS_DIR/$(map_dir "$region")"
  out="$dir/$code.pmtiles"
  tmp="$dir/.$code.building.pmtiles"
  local args=(--name="$(field "$region" name)") shared=()
  if is_natural_earth "$region"; then
    [[ -s "$IMPORTS_DIR/naturalearth/ne_10m_ocean.zip" ]] || die "Natural Earth not found: run 'download $code' first"
    places="$dir/$code.places.json"
    args+=(--natural_earth="$IMPORTS_DIR/naturalearth" --gazetteer="$places.tmp" --maxzoom="$WORLD_MAX_ZOOM")
  elif is_native "$region"; then
    local native_region bbox
    native_region=$(jq -r '.source.nativeRegion' <<<"$region")
    native_data="$IMPORTS_DIR/native/$native_region"
    [[ -s "$native_data/build.json" ]] || die "native map layers not found: run 'build $code' first"
    # The overlays (population, climate) get their own archive, built below.
    args+=(--native_data="$native_data" --native_layers=map)
    bbox=$(jq -r '.bbox // empty | join(",")' <<<"$region")
    shared=(--name="$(field "$region" name)")
    [[ -n "$bbox" ]] && shared+=(--bounds="$bbox") && args+=(--bounds="$bbox")
  else
    pbf="$IMPORTS_DIR/$code.osm.pbf"
    [[ -s "$pbf" ]] || die "$pbf not found: run 'download $code' first"
    args+=(--osm_path="$pbf")
    if [[ "$water" == true ]]; then
      args+=(--water_polygons="$(ensure_water_polygons)")
    fi
  fi
  mkdir -p "$dir"
  log "Building map tiles for $code"
  if ! run_tilegen "$tmp" "${args[@]}"; then
    rm -f "$tmp" ${places:+"$places.tmp"}
    die "tile generation failed for $code"
  fi
  mv -f "$tmp" "$out"
  chmod 644 "$out"
  match_owner "$out" "$MAPS_DIR"
  if [[ -n "$places" ]]; then
    mv -f "$places.tmp" "$places"
    chmod 644 "$places"
    match_owner "$places" "$MAPS_DIR"
    log "Place index ready: $places ($(jq '.places | length' "$places") places)"
  fi
  log "Map ready: $out ($(du -h "$out" | cut -f1))"
  [[ -n "$native_data" ]] && build_overlays "$code" "$dir" "$native_data" "${shared[@]}"
  match_owner "$dir" "$MAPS_DIR"
}

cmd_build() {
  local code=$1 region native_region
  region=$(region_json "$code")
  is_native "$region" || die "$code is not built from the native catalog"
  native_region=$(jq -r '.source.nativeRegion' <<<"$region")
  [[ -s "$IMPORTS_DIR/native/$native_region/manifest.json" ]] ||
    die "native sources not found: run 'download $code' first"
  local args=(build "$native_region")
  [[ "${SKIP_BUILDINGS:-false}" == true ]] && args+=(--skip-buildings)
  native-data "${args[@]}" >/dev/null
  match_owner "$IMPORTS_DIR/native/$native_region" "$IMPORTS_DIR"
  log "Road graph, search index and map layers ready: $IMPORTS_DIR/native/$native_region"
}

cmd_aliases() {
  local code=$1 region native_region
  region=$(region_json "$code")
  is_native "$region" || die "$code does not use the native search index"
  native_region=$(jq -r '.source.nativeRegion' <<<"$region")
  native-data aliases "$native_region"
  match_owner "$IMPORTS_DIR/native/$native_region" "$IMPORTS_DIR"
  log "Phones get the new names with the next offline pack: run 'pack <region>' and 'manifest <region>'"
}

# The offline pack of the mobile app: the roads and the search index of the region and a margin
# around it, in one file, so the phone calculates routes, finds places and names addresses without
# connection with the same data and rules as the backend. The same data always gives the same
# bytes: phones only download it again when something changed.
pack_file() { echo "$ROUTING_DIR/$1/$1.rmpack"; }

cmd_pack() {
  local code=$1 region native_region data bbox out
  region=$(region_json "$code")
  is_native "$region" || die "$code has no offline pack: only regions of the native catalog have one"
  native_region=$(jq -r '.source.nativeRegion' <<<"$region")
  data="$IMPORTS_DIR/native/$native_region"
  [[ -s "$data/graph.bin" && -s "$data/search.ndjson" ]] ||
    die "road graph or search index not found: run 'build $code' first"
  bbox=$(jq -r '.bbox // empty | join(",")' <<<"$region")
  [[ -n "$bbox" ]] || die "region '$code' needs a bbox in regions.json for its offline pack"
  out=$(pack_file "$code")
  log "Building the offline pack of $code (roads and search index, ${PACK_MARGIN_KM} km around it)"
  # --bbox=...: the bounds start with a minus sign.
  native-data pack --graph "$data/graph.bin" --search "$data/search.ndjson" --bbox="$bbox" \
    --margin-km "$PACK_MARGIN_KM" --region "$code" --name "$(field "$region" name)" \
    --output "$out" >/dev/null
  match_owner "$ROUTING_DIR/$code" "$ROUTING_DIR"
  log "Offline pack ready: $out ($(du -h "$out" | cut -f1))"
}

cmd_routing() {
  local code=$1 region
  region=$(region_json "$code")
  if is_natural_earth "$region"; then
    die "$code is a base map: it has no routing graph"
  fi
  if is_native "$region"; then
    die "$code uses the native official-data graph; Valhalla/OSM routing packages are disabled"
  fi
  build-routing.sh "$code"
  match_owner "$ROUTING_DIR/$code" "$ROUTING_DIR"
}

has_rasters() { [[ $(jq -r '.rasters // {} | length' <<<"$1") -gt 0 ]]; }

cmd_rasters() {
  local code=$1 force=$2 region
  region=$(region_json "$code")
  if ! has_rasters "$region"; then
    log "$code has no relief or satellite layers (rasters in regions.json)"
    return 0
  fi
  local args=(download "$code")
  [[ "$force" == true ]] && args+=(--force)
  raster-data "${args[@]}"
  match_owner "$IMPORTS_DIR/raster" "$IMPORTS_DIR"
  raster-data build "$code"
  local kind file
  for kind in "${ASSET_KINDS[@]}"; do
    file="$MAPS_DIR/$(map_dir "$region")/$code.$kind.pmtiles"
    [[ -s "$file" ]] && match_owner "$file" "$MAPS_DIR"
  done
  return 0
}

# Reads zoom range, bounds and tile format from the PMTiles v3 header.
pmtiles_header() {
  local file=$1
  [[ "$(head -c 7 "$file")" == "PMTiles" ]] || die "$file is not a PMTiles archive"
  local zooms bounds type
  type=$(od -An -tu1 -j99 -N1 "$file" | xargs)
  zooms=$(od -An -tu1 -j100 -N2 "$file" | xargs)
  bounds=$(od -An -td4 -j102 -N16 --endian=little "$file" | xargs)
  jq -cn --arg zooms "$zooms" --arg bounds "$bounds" --argjson type "$type" \
    '($zooms | split(" ") | map(tonumber)) as $z
     | ($bounds | split(" ") | map(tonumber / 10000000)) as $b
     | {minZoom: $z[0], maxZoom: $z[1], bbox: $b,
        format: ({"1": "pbf", "2": "png", "3": "jpg", "4": "webp", "5": "avif"}[$type | tostring] // "unknown")}'
}

# Extra archives of a region (relief, satellite, overlays) as a JSON array for its manifest.
region_assets() {
  local code=$1 dir=$2 kind rel file header sha assets='[]'
  for kind in "${ASSET_KINDS[@]}"; do
    rel="$dir/$code.$kind.pmtiles"
    file="$MAPS_DIR/$rel"
    [[ -s "$file" ]] || continue
    header=$(pmtiles_header "$file")
    sha=$(sha256sum "$file" | cut -d' ' -f1)
    assets=$(jq -c --arg kind "$kind" --arg file "$rel" --arg sha "$sha" --argjson header "$header" \
      '. + [{kind: $kind, file: $file, checksum: $sha, minZoom: $header.minZoom, maxZoom: $header.maxZoom,
             format: $header.format}]' <<<"$assets")
  done
  echo "$assets"
}

cmd_manifest() {
  local code=$1
  local region dir map_rel map_file routing_rel routing_file header bbox version data_time manifest
  region=$(region_json "$code")
  dir=$(map_dir "$region")
  map_rel="$dir/$code.pmtiles"
  map_file="$MAPS_DIR/$map_rel"
  [[ -s "$map_file" ]] || die "$map_file not found: run 'map $code' first"
  if is_native "$region"; then
    # The offline pack of the phone; a legacy Valhalla graph never leaks into the manifest of a
    # region of the native catalog.
    routing_rel="$code/$code.rmpack"
    routing_file="$ROUTING_DIR/$routing_rel"
    local native_data
    native_data="$IMPORTS_DIR/native/$(jq -r '.source.nativeRegion' <<<"$region")"
    if [[ -s "$routing_file" && ("$native_data/graph.bin" -nt "$routing_file" ||
      "$native_data/search.ndjson" -nt "$routing_file") ]]; then
      log "WARNING: the offline pack of $code is older than its road graph or search index;" \
        "phones keep the previous data until 'pack $code' and 'manifest $code' run"
    fi
  elif is_natural_earth "$region"; then
    routing_rel=""
    routing_file=""
  else
    routing_rel="$code/$code.valhalla.tar"
    routing_file="$ROUTING_DIR/$routing_rel"
  fi

  header=$(pmtiles_header "$map_file")
  bbox=$(jq -c '.bbox // empty' <<<"$region")
  [[ -n "$bbox" ]] || bbox=$(jq -c '.bbox' <<<"$header")
  version="${REGION_VERSION:-$(date -u +%Y.%m.%d.%H%M)}"
  data_time=""
  if is_native "$region"; then
    local native_region
    native_region=$(jq -r '.source.nativeRegion' <<<"$region")
    if [[ -s "$IMPORTS_DIR/native/$native_region/manifest.json" ]]; then
      data_time=$(jq -r '.generatedAt // empty' "$IMPORTS_DIR/native/$native_region/manifest.json")
    fi
  elif [[ -s "$IMPORTS_DIR/$code.osm.pbf" ]]; then
    data_time=$(osmium fileinfo --no-progress -g header.option.osmosis_replication_timestamp \
      "$IMPORTS_DIR/$code.osm.pbf" 2>/dev/null || true)
  fi

  log "Computing checksums for $code"
  local map_sha routing_sha="" assets
  map_sha=$(sha256sum "$map_file" | cut -d' ' -f1)
  assets=$(region_assets "$code" "$dir")
  if [[ -n "$routing_file" && -s "$routing_file" ]]; then
    routing_sha=$(sha256sum "$routing_file" | cut -d' ' -f1)
  else
    if is_native "$region"; then
      log "No offline pack for $code (run 'pack $code'): phones get the map without routes or search"
    else
      log "No distributable routing package for $code; the manifest only lists the map"
    fi
    routing_rel=""
  fi

  manifest="$MAPS_DIR/$dir/$code.region.json"
  jq -n \
    --argjson region "$region" --argjson header "$header" --argjson bbox "$bbox" \
    --arg version "$version" --arg mapFile "$map_rel" --arg mapChecksum "$map_sha" \
    --arg routingFile "$routing_rel" --arg routingChecksum "$routing_sha" \
    --arg dataTimestamp "$data_time" --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson assets "$assets" \
    '{
      code: $region.code, name: $region.name, country: $region.country,
      province: $region.province, city: $region.city,
      version: $version, bbox: $bbox,
      minZoom: $header.minZoom, maxZoom: $header.maxZoom,
      mapFile: $mapFile, mapChecksum: $mapChecksum,
      routingFile: (if $routingFile == "" then null else $routingFile end),
      routingChecksum: (if $routingChecksum == "" then null else $routingChecksum end),
      assets: $assets,
      source: (if $region.source.nativeRegion then "native-catalog:" + $region.source.nativeRegion
               else ($region.source.url // (if $region.source.parent then "legacy:" + $region.source.parent
               else "public-domain-world" end)) end),
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
  local code=$1 force=$2 skip_routing=$3 water=$4 skip_rasters=$5
  local started=$SECONDS region
  region=$(region_json "$code")
  cmd_download "$code" "$force"
  if is_native "$region"; then
    local native_region
    native_region=$(jq -r '.source.nativeRegion' <<<"$region")
    # Regions sharing a native catalog (ecuador, guayas, quito...) build it once.
    if [[ ! -s "$IMPORTS_DIR/native/$native_region/build.json" || "$force" == true ||
      "$IMPORTS_DIR/native/$native_region/manifest.json" -nt "$IMPORTS_DIR/native/$native_region/build.json" ]]; then
      cmd_build "$code"
    fi
  fi
  cmd_map "$code" "$water"
  if [[ "$skip_rasters" != true ]]; then
    cmd_rasters "$code" "$force"
  fi
  if [[ "$skip_routing" != true ]] && is_native "$region"; then
    cmd_pack "$code"
  elif [[ "$skip_routing" != true ]] && ! is_natural_earth "$region"; then
    cmd_routing "$code"
  fi
  cmd_manifest "$code" >/dev/null
  log "Region $code prepared in $((SECONDS - started)) s."
  log "Register it in the backend: make regions-sync (it is also picked up on backend start)."
}

cmd_list() {
  printf '%-12s %-24s %-8s %-8s %-8s %-18s %s\n' CODE NAME EXTRACT MAP ROUTING ASSETS SOURCE
  jq -r '.regions[] | [.code, .name, (.mapDir // .code),
      (if .source.nativeRegion then "native:" + .source.nativeRegion else
       (.source.url // (if .source.parent then "legacy:" + .source.parent else "public-domain-world" end)) end)] | @tsv' "$CATALOG" |
    while IFS=$'\t' read -r code name dir source; do
      local extract=no map=no routing=no assets="" kind
      [[ -s "$IMPORTS_DIR/$code.osm.pbf" ]] && extract=yes
      [[ "$source" == native:* && -s "$IMPORTS_DIR/native/${source#native:}/manifest.json" ]] && extract=yes
      [[ "$source" == public-domain-world && -s "$IMPORTS_DIR/naturalearth/ne_10m_ocean.zip" ]] && extract=yes
      [[ -s "$MAPS_DIR/$dir/$code.pmtiles" ]] && map=yes
      if [[ -s "$(pack_file "$code")" ]]; then
        routing=pack
      elif [[ -s "$ROUTING_DIR/$code/valhalla.json" ]]; then
        routing=valhalla
      fi
      for kind in "${ASSET_KINDS[@]}"; do
        [[ -s "$MAPS_DIR/$dir/$code.$kind.pmtiles" ]] && assets+="${assets:+,}$kind"
      done
      printf '%-12s %-24s %-8s %-8s %-8s %-18s %s\n' "$code" "$name" "$extract" "$map" "$routing" \
        "${assets:--}" "$source"
    done
  echo
  echo "Only regions backed by the audited source catalog are accepted."
}

# ------------------------------------------------------------------ main

main() {
  [[ $# -ge 1 ]] || usage 64
  local command=$1
  shift
  local code="" force=false skip_routing=false water=false skip_rasters=false
  while [[ $# -gt 0 ]]; do
    case "$1" in
    --force-download) force=true ;;
    --skip-routing) skip_routing=true ;;
    --skip-rasters) skip_rasters=true ;;
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
  source-version) cmd_source_version "${code:?region required}" ;;
  download) cmd_download "${code:?region required}" "$force" ;;
  build) cmd_build "${code:?region required}" ;;
  aliases) cmd_aliases "${code:?region required}" ;;
  map) cmd_map "${code:?region required}" "$water" ;;
  rasters) cmd_rasters "${code:?region required}" "$force" ;;
  pack) cmd_pack "${code:?region required}" ;;
  routing) cmd_routing "${code:?region required}" ;;
  manifest) cmd_manifest "${code:?region required}" ;;
  prepare) cmd_prepare "${code:?region required}" "$force" "$skip_routing" "$water" "$skip_rasters" ;;
  help | -h | --help) usage 0 ;;
  *) die "unknown command '$command' (see: help)" ;;
  esac
}

main "$@"
