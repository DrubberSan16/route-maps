#!/usr/bin/env python3
"""Relief and satellite layers of a region, from open raster sources, as PMTiles archives the
platform serves itself.

    raster-data download <region> [--only terrain|satellite] [--force]
    raster-data build <region> [--only terrain|satellite] [--workers N]

Which layers a region has, and up to which zoom, is set in regions.json (`rasters`); the sources
(URLs, licences and citations) are in the "rasters" section of sources.json. Downloads are cached in
/data/imports/raster and recorded, with their ETag and size, in /data/imports/raster/<region>.sources.json.
The archives are written to /data/maps/<mapDir>/<region>.terrain.pmtiles and
<region>.satellite.pmtiles, which `region.sh manifest` lists as the region's assets.
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# The pipeline library lives next to this script in the repository and in /opt/mapsdata in the image.
for candidate in (Path(__file__).resolve().parent.parent / "lib", Path("/opt/mapsdata")):
    if (candidate / "mapsdata").is_dir():
        sys.path.insert(0, str(candidate))
        break

from mapsdata import imagery, terrain, tiling  # noqa: E402

REGIONS = Path(os.environ.get("REGIONS_CATALOG", "/etc/maps-platform/regions.json"))
SOURCES = Path(os.environ.get("SOURCES_CATALOG", "/etc/maps-platform/sources.json"))
IMPORTS = Path(os.environ.get("IMPORTS_DIR", "/data/imports")) / "raster"
MAPS = Path(os.environ.get("MAPS_DIR", "/data/maps"))
USER_AGENT = os.environ.get("DOWNLOAD_USER_AGENT", "maps-platform-raster-data/1.0")
KINDS = ("terrain", "satellite")


def log(message: str) -> None:
    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] {message}", file=sys.stderr, flush=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def region_config(code: str) -> dict[str, Any]:
    for item in load(REGIONS).get("regions", []):
        if item.get("code") == code:
            if not item.get("bbox"):
                raise SystemExit(f"{code} has no bbox: relief and satellite layers need one")
            return item
    raise SystemExit(f"unknown region: {code}")


def raster_source(kind: str) -> dict[str, Any]:
    source = (load(SOURCES).get("rasters") or {}).get(kind)
    if not source:
        raise SystemExit(f"sources.json has no raster source for {kind}")
    return source


def wanted(region: dict[str, Any], only: str | None) -> list[str]:
    configured = region.get("rasters") or {}
    kinds = [kind for kind in KINDS if kind in configured and (only is None or only == kind)]
    if only and only not in configured:
        raise SystemExit(f"{region['code']} has no {only} layer in regions.json")
    return kinds


def output_path(region: dict[str, Any], kind: str) -> Path:
    return MAPS / (region.get("mapDir") or region["code"]) / f"{region['code']}.{kind}.pmtiles"


# ---------------------------------------------------------------- downloads

def http(url: str, method: str = "GET", attempts: int = 5) -> Any:
    request = urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT})
    error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return urllib.request.urlopen(request, timeout=120, context=ssl.create_default_context())
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 404):
                raise
            error = exc
        except Exception as exc:  # noqa: BLE001 - retry network failures alike
            error = exc
        if attempt < attempts:
            time.sleep(min(2 ** attempt, 30))
    raise RuntimeError(f"could not fetch {url}: {error}")


def exists(url: str) -> dict[str, Any] | None:
    """ETag and size of a remote file, or None when it does not exist."""
    try:
        with http(url, "HEAD") as response:
            return {"etag": (response.headers.get("ETag") or "").strip('"'),
                    "size": int(response.headers.get("Content-Length") or 0)}
    except urllib.error.HTTPError as exc:
        if exc.code in (403, 404):
            return None
        raise


def download(url: str, target: Path) -> dict[str, Any]:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.part")
    with http(url) as response, temporary.open("wb") as handle:
        etag = (response.headers.get("ETag") or "").strip('"')
        expected = int(response.headers.get("Content-Length") or 0)
        while chunk := response.read(1 << 20):
            handle.write(chunk)
    size = temporary.stat().st_size
    if expected and size != expected:
        temporary.unlink()
        raise RuntimeError(f"{url}: received {size} of {expected} bytes")
    temporary.replace(target)
    return {"url": url, "etag": etag, "size": size}


def valid_geotiff(path: Path) -> bool:
    import rasterio

    try:
        with rasterio.open(path) as dataset:
            return dataset.count >= 1 and dataset.width > 0 and dataset.crs is not None
    except Exception:  # noqa: BLE001 - any read failure means the copy is unusable
        return False


def dem_names(source: dict[str, Any], bbox: list[float], force: bool) -> list[str]:
    listing = IMPORTS / source["id"] / "tileList.txt"
    if force or not listing.exists():
        download(source["tileList"], listing)
    names = terrain.dem_tiles_for(bbox, listing.read_text(encoding="utf-8").split(), source.get("code", "10"))
    if not names:
        raise SystemExit(f"no {source['id']} tiles intersect {bbox}")
    return names


def download_terrain(region: dict[str, Any], force: bool) -> list[dict[str, Any]]:
    source = raster_source("terrain")
    files = []
    names = dem_names(source, region["bbox"], force)
    log(f"Relief of {region['code']}: {len(names)} elevation tiles of {source['id']}")
    for name in names:
        target = IMPORTS / source["id"] / f"{name}.tif"
        url = f"{source['url'].rstrip('/')}/{name}/{name}.tif"
        if target.exists() and not force and valid_geotiff(target):
            files.append({"url": url, "file": str(target.relative_to(IMPORTS)), "size": target.stat().st_size,
                          "status": "cached"})
            continue
        log(f"Downloading {name}")
        entry = download(url, target)
        if not valid_geotiff(target):
            target.unlink(missing_ok=True)
            raise RuntimeError(f"{url} is not a readable GeoTIFF")
        files.append({**entry, "file": str(target.relative_to(IMPORTS)), "status": "downloaded"})
    return files


def imagery_dir(region: dict[str, Any]) -> Path:
    return IMPORTS / "imagery" / region["code"]


def download_satellite(region: dict[str, Any], force: bool) -> list[dict[str, Any]]:
    source = raster_source("satellite")
    max_zoom = int(region["rasters"]["satellite"]["maxZoom"])
    factor = imagery.overview_factor(max_zoom)
    bbox = region["bbox"]
    directory = imagery_dir(region)
    files = []
    cells = imagery.cells_for(bbox)
    log(f"Satellite of {region['code']}: {len(cells)} cells at 1/{factor} of the full resolution")
    for lat, lon in cells:
        name = imagery.cell_name(lat, lon)
        years = [(year, version) for year, version in source["years"]]
        urls, remote = [], []
        for year, version in years:
            url = imagery.cell_url(source["url"].rstrip("/"), year, version, lat, lon)
            info = exists(url)
            if info is not None:
                urls.append(url)
                remote.append({"url": url, **info})
        if not urls:
            continue  # open sea: no composite
        target = directory / f"{name}.raw.tif"
        stamp = directory / f"{name}.raw.json"
        fingerprint = {"urls": remote, "bbox": bbox, "factor": factor}
        if target.exists() and stamp.exists() and not force and load(stamp).get("fingerprint") == fingerprint:
            files.append({"cell": name, "sources": remote, "status": "cached"})
            continue
        log(f"Reading {name} ({', '.join(str(year) for year, _ in years)})")
        details = imagery.fetch_cell(urls, bbox, factor, target)
        stamp.write_text(json.dumps({"fingerprint": fingerprint, "details": details}, indent=2), encoding="utf-8")
        files.append({"cell": name, "sources": remote, **details, "status": "downloaded"})
    if not files:
        raise SystemExit(f"no satellite composite covers {bbox}")
    return files


def command_download(args: argparse.Namespace) -> None:
    region = region_config(args.region)
    kinds = wanted(region, args.only)
    if not kinds:
        log(f"{region['code']} has no relief or satellite layers (regions.json)")
        return
    record_path = IMPORTS / f"{region['code']}.sources.json"
    record = load(record_path) if record_path.exists() else {}
    for kind in kinds:
        files = download_terrain(region, args.force) if kind == "terrain" else download_satellite(region, args.force)
        source = raster_source(kind)
        record[kind] = {"source": source["id"], "license": source.get("license"), "downloadedAt": now_iso(),
                        "files": files}
    IMPORTS.mkdir(parents=True, exist_ok=True)
    temporary = record_path.with_name(f".{record_path.name}.part")
    temporary.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(record_path)
    log(f"Sources recorded in {record_path}")


# ---------------------------------------------------------------- builds

def metadata(kind: str) -> dict[str, Any]:
    source = raster_source(kind)
    license_ = source.get("license") or {}
    return {"attribution": license_.get("citation", ""), "description": source.get("title", ""),
            "source": source["id"]}


def build_terrain(region: dict[str, Any], workers: int) -> dict[str, Any]:
    source = raster_source("terrain")
    listing = IMPORTS / source["id"] / "tileList.txt"
    if not listing.exists():
        raise SystemExit(f"elevation sources not found: run 'raster-data download {region['code']}' first")
    names = terrain.dem_tiles_for(region["bbox"], listing.read_text(encoding="utf-8").split(),
                                  source.get("code", "10"))
    files = {name: IMPORTS / source["id"] / f"{name}.tif" for name in names}
    missing = [name for name, path in files.items() if not path.exists()]
    if missing:
        raise SystemExit(f"{len(missing)} elevation tiles missing (first: {missing[0]}): run 'download' first")
    layer = terrain.TerrainLayer(files, metadata("terrain"))
    max_zoom = int(region["rasters"]["terrain"]["maxZoom"])
    return tiling.build_archive(layer, region["bbox"], 0, max_zoom, output_path(region, "terrain"),
                                f"{region['name']} (relieve)", workers)


def build_satellite(region: dict[str, Any], workers: int) -> dict[str, Any]:
    directory = imagery_dir(region)
    cells = {}
    for lat, lon in imagery.cells_for(region["bbox"]):
        name = imagery.cell_name(lat, lon)
        raw = directory / f"{name}.raw.tif"
        if not raw.exists():
            continue
        prepared = directory / f"{name}.rgba.tif"
        if not prepared.exists() or prepared.stat().st_mtime < raw.stat().st_mtime:
            log(f"Preparing the colours of {name}")
            imagery.prepare_cell(raw, prepared)
        cells[name] = (prepared, imagery.cell_bounds(lat, lon))
    if not cells:
        raise SystemExit(f"satellite sources not found: run 'raster-data download {region['code']}' first")
    layer = imagery.ImageryLayer(cells, metadata("satellite"))
    max_zoom = int(region["rasters"]["satellite"]["maxZoom"])
    return tiling.build_archive(layer, region["bbox"], 0, max_zoom, output_path(region, "satellite"),
                                f"{region['name']} (satélite)", workers)


def command_build(args: argparse.Namespace) -> None:
    region = region_config(args.region)
    kinds = wanted(region, args.only)
    if not kinds:
        log(f"{region['code']} has no relief or satellite layers (regions.json)")
        return
    workers = args.workers or int(os.environ.get("RASTER_WORKERS") or 0) or os.cpu_count() or 1
    for kind in kinds:
        summary = build_terrain(region, workers) if kind == "terrain" else build_satellite(region, workers)
        log(f"{kind} ready: {output_path(region, kind)} ({summary['bytes'] / 1e6:.1f} MB, "
            f"zoom {summary['minZoom']}-{summary['maxZoom']})")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    download_parser = sub.add_parser("download", help="download the sources of the region's raster layers")
    download_parser.add_argument("region")
    download_parser.add_argument("--only", choices=KINDS)
    download_parser.add_argument("--force", action="store_true", help="download again what is cached")
    download_parser.set_defaults(handler=command_download)
    build_parser = sub.add_parser("build", help="write the region's relief and satellite PMTiles")
    build_parser.add_argument("region")
    build_parser.add_argument("--only", choices=KINDS)
    build_parser.add_argument("--workers", type=int, default=0, help="parallel processes (default: all CPUs)")
    build_parser.set_defaults(handler=command_build)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
