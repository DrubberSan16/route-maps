#!/usr/bin/env python3
"""Download and validate non-OSM geospatial sources into an auditable local cache."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import ssl
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


CATALOG = Path(os.environ.get("SOURCES_CATALOG", "/etc/maps-platform/sources.json"))
IMPORTS = Path(os.environ.get("IMPORTS_DIR", "/data/imports")) / "native"
USER_AGENT = os.environ.get("DOWNLOAD_USER_AGENT", "maps-platform-native-data/1.0")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_catalog() -> dict[str, Any]:
    with CATALOG.open(encoding="utf-8") as handle:
        return json.load(handle)


def region(catalog: dict[str, Any], code: str) -> dict[str, Any]:
    for item in catalog.get("regions", []):
        if item.get("code") == code:
            return item
    raise SystemExit(f"unknown native data region: {code}")


def request_json(url: str, attempts: int = 4) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=90, context=ssl.create_default_context()) as response:
                return json.load(response)
        except Exception as exc:  # noqa: BLE001 - retry network and decoding failures alike
            error = exc
            if attempt < attempts:
                time.sleep(min(2**attempt, 10))
    raise RuntimeError(f"could not fetch {url}: {error}")


def query_url(base: str, values: dict[str, Any]) -> str:
    return f"{base}?{urllib.parse.urlencode(values)}"


def iter_coordinates(value: Any) -> Iterable[tuple[float, float]]:
    if isinstance(value, list) and len(value) >= 2 and all(isinstance(v, (int, float)) for v in value[:2]):
        yield float(value[0]), float(value[1])
    elif isinstance(value, list):
        for child in value:
            yield from iter_coordinates(child)


def validate_feature(feature: dict[str, Any], source: dict[str, Any], bbox: list[float]) -> None:
    geometry = feature.get("geometry") or {}
    geometry_type = geometry.get("type")
    if geometry_type not in source.get("expectedGeometry", []):
        raise ValueError(f"{source['id']}: unexpected geometry {geometry_type!r}")
    coordinates = list(iter_coordinates(geometry.get("coordinates")))
    if not coordinates:
        raise ValueError(f"{source['id']}: empty geometry")
    min_lng, min_lat, max_lng, max_lat = bbox
    # A small margin tolerates official maritime/insular extents near the declared bounds.
    margin = 1.0
    for lng, lat in coordinates:
        if not (-180 <= lng <= 180 and -90 <= lat <= 90):
            raise ValueError(f"{source['id']}: coordinate is not EPSG:4326: {lng},{lat}")
        if not (min_lng - margin <= lng <= max_lng + margin and min_lat - margin <= lat <= max_lat + margin):
            raise ValueError(f"{source['id']}: coordinate outside region bounds: {lng},{lat}")


def arcgis_pages(source: dict[str, Any]) -> tuple[dict[str, Any], Iterable[dict[str, Any]]]:
    base = source["url"].rstrip("/")
    metadata = request_json(query_url(base, {"f": "json"}))
    if metadata.get("error"):
        raise RuntimeError(f"{source['id']}: metadata error: {metadata['error']}")
    object_id = metadata.get("objectIdField") or metadata.get("objectIdFieldName")
    page_size = min(int(metadata.get("maxRecordCount") or 2000), 4000)
    count_data = request_json(query_url(f"{base}/query", {"where": "1=1", "returnCountOnly": "true", "f": "json"}))
    total = int(count_data.get("count") or 0)

    def pages() -> Iterable[dict[str, Any]]:
        offset = 0
        while offset < total:
            params: dict[str, Any] = {
                "where": "1=1",
                "outFields": "*",
                "returnGeometry": "true",
                "outSR": "4326",
                "f": "geojson",
                "resultOffset": offset,
                "resultRecordCount": page_size,
                "geometryPrecision": 6,
            }
            if source.get("maxAllowableOffset"):
                params["maxAllowableOffset"] = source["maxAllowableOffset"]
            if object_id:
                params["orderByFields"] = object_id
            page = request_json(query_url(f"{base}/query", params))
            if page.get("error"):
                raise RuntimeError(f"{source['id']}: query error: {page['error']}")
            features = page.get("features") or []
            if not features:
                raise RuntimeError(f"{source['id']}: source stopped at {offset} of {total} features")
            yield from features
            offset += len(features)

    return {"declaredCount": total, "metadata": metadata}, pages()


def wfs_features(source: dict[str, Any]) -> tuple[dict[str, Any], Iterable[dict[str, Any]]]:
    url = query_url(
        source["url"],
        {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": source["typeName"],
            "outputFormat": "application/json",
            "srsName": "EPSG:4326",
        },
    )
    data = request_json(url)
    return {"declaredCount": int(data.get("totalFeatures") or len(data.get("features") or []))}, iter(data.get("features") or [])


def download_layer(source: dict[str, Any], destination: Path, bbox: list[float], force: bool) -> dict[str, Any]:
    target = destination / f"{source['id']}.geojson"
    if target.exists() and target.stat().st_size > 0 and not force:
        with target.open(encoding="utf-8") as handle:
            data = json.load(handle)
        return {
            "id": source["id"],
            "status": "cached",
            "featureCount": len(data.get("features") or []),
            "bytes": target.stat().st_size,
            "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        }

    if source["kind"] == "arcgis-feature-layer":
        details, features = arcgis_pages(source)
    elif source["kind"] == "wfs-geojson":
        details, features = wfs_features(source)
    else:
        raise RuntimeError(f"{source['id']}: unsupported downloadable kind {source['kind']}")

    destination.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{source['id']}.", suffix=".part", dir=destination)
    count = 0
    digest = hashlib.sha256()
    try:
        with os.fdopen(descriptor, "wb") as output:
            prefix = b'{"type":"FeatureCollection","features":['
            output.write(prefix)
            digest.update(prefix)
            first = True
            for feature in features:
                validate_feature(feature, source, bbox)
                encoded = json.dumps(feature, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                if not first:
                    output.write(b",")
                    digest.update(b",")
                output.write(encoded)
                digest.update(encoded)
                first = False
                count += 1
            suffix = b"]}"
            output.write(suffix)
            digest.update(suffix)
            output.flush()
            os.fsync(output.fileno())
        if count != details["declaredCount"]:
            raise RuntimeError(f"{source['id']}: received {count}, expected {details['declaredCount']}")
        os.replace(temporary, target)
        os.chmod(target, 0o644)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise
    return {
        "id": source["id"],
        "status": "downloaded",
        "featureCount": count,
        "bytes": target.stat().st_size,
        "sha256": digest.hexdigest(),
    }


def command_list(args: argparse.Namespace) -> None:
    catalog = load_catalog()
    selected = region(catalog, args.region) if args.region else None
    regions = [selected] if selected else catalog.get("regions", [])
    for item in regions:
        print(f"{item['code']}: {item['name']}")
        for source in item.get("layers", []):
            mode = "manual" if source.get("download") is False else "large" if source.get("large") else "normal"
            print(f"  {source['id']:<32} {source['role']:<15} {mode:<7} {source['organization']}")


def selected_sources(item: dict[str, Any], args: argparse.Namespace) -> list[dict[str, Any]]:
    layers = []
    requested = set(args.layer or [])
    for source in item.get("layers", []):
        if requested and source["id"] not in requested:
            continue
        if source.get("download") is False:
            continue
        if source.get("large") and not args.include_large and source["id"] not in requested:
            continue
        if not source.get("required") and not args.include_optional and source["id"] not in requested:
            continue
        layers.append(source)
    missing = requested - {source["id"] for source in layers}
    if missing:
        raise SystemExit(f"unknown or non-downloadable layers: {', '.join(sorted(missing))}")
    return layers


def command_download(args: argparse.Namespace) -> None:
    catalog = load_catalog()
    item = region(catalog, args.region)
    destination = IMPORTS / item["code"]
    manifest_path = destination / "manifest.json"
    previous: dict[str, Any] = {}
    if manifest_path.exists():
        with manifest_path.open(encoding="utf-8") as handle:
            previous = {entry["id"]: entry for entry in json.load(handle).get("layers", [])}
    reports = []
    for source in selected_sources(item, args):
        print(f"downloading {source['id']}...", file=sys.stderr, flush=True)
        reports.append(download_layer(source, destination, item["bbox"], args.force))
        print(f"  {reports[-1]['featureCount']} features, {reports[-1]['bytes']} bytes", file=sys.stderr)
    updated = {entry["id"]: entry for entry in reports}
    # A targeted refresh must not erase the audit records of the other cached layers.
    if args.layer:
        updated = {**previous, **updated}
        reports = [updated[source["id"]] for source in item.get("layers", []) if source["id"] in updated]
    manifest = {
        "schemaVersion": 1,
        "region": item["code"],
        "generatedAt": now_iso(),
        "coordinateReference": "EPSG:4326",
        "bbox": item["bbox"],
        "layers": reports,
    }
    destination.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(manifest_path, 0o644)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    listing = sub.add_parser("list")
    listing.add_argument("region", nargs="?")
    listing.set_defaults(handler=command_list)
    download = sub.add_parser("download")
    download.add_argument("region")
    download.add_argument("--layer", action="append", help="download only this layer (repeatable)")
    download.add_argument("--include-optional", action="store_true")
    download.add_argument("--include-large", action="store_true")
    download.add_argument("--force", action="store_true")
    download.set_defaults(handler=command_download)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
