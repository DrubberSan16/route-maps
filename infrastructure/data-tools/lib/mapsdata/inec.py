"""National census cartography (Marco Geoestadístico Nacional) as local, reprojected layers.

The cartography is published as one GeoPackage per province (plus a national package that
is the only one with the population grid). Each package is downloaded, checked, converted
into compact line-delimited GeoJSON (gzip) in `<imports>/<region>/inec/<chunk>/` and deleted,
so the disk never holds more than one province. A chunk is only processed again when its
remote size, date or ETag changes.

Raw attribute values are kept in the cache; display labels are produced later, when the
national layers are assembled, because the accent dictionary needs every name first.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator

from . import geo

BASE_URL = "https://www.ecuadorencifras.gob.ec/documentos/web-inec/Geografia_Estadistica/Documentos/"
PROVINCES = {
    "01": "AZUAY", "02": "BOLIVAR", "03": "CANAR", "04": "CARCHI", "05": "COTOPAXI", "06": "CHIMBORAZO",
    "07": "EL_ORO", "08": "ESMERALDAS", "09": "GUAYAS", "10": "IMBABURA", "11": "LOJA", "12": "LOS_RIOS",
    "13": "MANABI", "14": "MORONA_SANTIAGO", "15": "NAPO", "16": "PASTAZA", "17": "PICHINCHA",
    "18": "TUNGURAHUA", "19": "ZAMORA_CHINCHIPE", "20": "GALAPAGOS", "21": "SUCUMBIOS", "22": "ORELLANA",
    "23": "SANTO_DOMINGO_DE_LOS_TSACHILAS", "24": "SANTA_ELENA",
}
NATIONAL_FILE = "marco_geoestadistico_2026.zip"

#: Cached layers of every chunk (gzip NDJSON of GeoJSON features with raw attributes).
LAYERS = ("streets", "blocks", "landuse", "buildings", "areas", "localities", "landmarks", "population")
LANDUSE_CATEGORIES = {"PARQUE", "CAMPO DEPORTIVO", "CEMENTERIO", "PLAZA"}
CACHE_VERSION = 1
DIGITS = 6


def log(message: str) -> None:
    print(f"[inec] {message}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------- remote files


def remote_fingerprint(url: str, user_agent: str) -> str:
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": user_agent})
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                length = response.headers.get("Content-Length") or "?"
                modified = response.headers.get("Last-Modified") or "?"
                etag = (response.headers.get("ETag") or "").strip('"')
                return f"{length}|{modified}|{etag}"
        except Exception as error:  # noqa: BLE001 - network errors are retried alike
            last_error = error
            time.sleep(2 ** attempt)
    raise RuntimeError(f"could not read the metadata of {url}: {last_error}")


def download(url: str, target: Path, user_agent: str) -> str:
    """Downloads url into target (resuming), returns the SHA-256 of the file."""
    part = target.with_suffix(target.suffix + ".part")
    for attempt in range(5):
        offset = part.stat().st_size if part.exists() else 0
        headers = {"User-Agent": user_agent}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=180) as response:
                if offset and response.status != 206:
                    offset = 0
                with part.open("ab" if offset else "wb") as output:
                    shutil.copyfileobj(response, output, 1 << 22)
            break
        except Exception as error:  # noqa: BLE001
            log(f"download interrupted ({error}); retrying")
            time.sleep(min(60, 5 * (attempt + 1)))
    else:
        raise RuntimeError(f"could not download {url}")
    digest = hashlib.sha256()
    with part.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 22), b""):
            digest.update(block)
    part.replace(target)
    return digest.hexdigest()


def extract_geopackage(archive: Path, directory: Path) -> Path:
    with zipfile.ZipFile(archive) as bundle:
        members = [item for item in bundle.infolist() if item.filename.lower().endswith(".gpkg")]
        if len(members) != 1:
            raise RuntimeError(f"{archive.name}: expected one GeoPackage, found {len(members)}")
        free = shutil.disk_usage(directory).free
        if members[0].file_size > free - (512 << 20):
            raise RuntimeError(f"{archive.name}: not enough disk to extract {members[0].file_size} bytes")
        target = directory / Path(members[0].filename).name
        with bundle.open(members[0]) as source, target.open("wb") as output:
            shutil.copyfileobj(source, output, 1 << 22)
    return target


# ---------------------------------------------------------------- GeoPackage conversion


class ChunkWriter:
    """Writes the cached layers of one chunk atomically."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.temporary = Path(tempfile.mkdtemp(prefix=".inec-", dir=directory.parent))
        self.handles = {name: gzip.open(self.temporary / f"{name}.ndjson.gz", "wt", encoding="utf-8", compresslevel=5)
                        for name in LAYERS}
        self.counts = {name: 0 for name in LAYERS}

    def write(self, layer: str, geometry: dict[str, Any], properties: dict[str, Any]) -> None:
        feature = {"type": "Feature", "properties": properties, "geometry": geometry}
        self.handles[layer].write(json.dumps(feature, ensure_ascii=False, separators=(",", ":")) + "\n")
        self.counts[layer] += 1

    def commit(self, meta: dict[str, Any]) -> None:
        for handle in self.handles.values():
            handle.close()
        (self.temporary / "meta.json").write_text(
            json.dumps({**meta, "counts": self.counts}, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
        if self.directory.exists():
            shutil.rmtree(self.directory)
        self.temporary.replace(self.directory)

    def abort(self) -> None:
        for handle in self.handles.values():
            handle.close()
        shutil.rmtree(self.temporary, ignore_errors=True)


def _text(value: Any) -> str | None:
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def _line(points: list[geo.Point], project: Callable) -> list[list[float]] | None:
    out: list[list[float]] = []
    for x, y in points:
        lon, lat = project(x, y)
        point = [round(lon, DIGITS), round(lat, DIGITS)]
        if not out or out[-1] != point:
            out.append(point)
    return out if len(out) >= 2 else None


def _polygon(rings: list[list[geo.Point]], project: Callable) -> list[list[list[float]]] | None:
    out = []
    for ring in rings:
        converted = _line(ring, project)
        if not converted or len(converted) < 3:
            continue
        if converted[0] != converted[-1]:
            converted.append(converted[0])
        if len(converted) >= 4:
            out.append(converted)
    return out or None


def _local(project: Callable, parts) -> Callable:
    """Affine approximation of `project` around a feature smaller than 2 km (UTM input).

    Transverse Mercator is smooth enough that the error stays under 5 cm over 2 km even in the
    Galapagos (10 degrees off the zone), far below the 1 m precision of the cartography, while it
    is several times faster than the exact series. Only used for polygons: streets keep the exact
    projection so that shared vertices stay identical.
    """
    first = parts[0][0][0]
    xs = [p[0] for part in parts for ring in part for p in ring]
    ys = [p[1] for part in parts for ring in part for p in ring]
    if abs(first[1]) <= 90 or max(xs) - min(xs) > 2000 or max(ys) - min(ys) > 2000:  # degrees or large
        return project
    x0, y0 = first
    lon0, lat0 = project(x0, y0)
    lon1, lat1 = project(x0 + 100.0, y0)
    lon2, lat2 = project(x0, y0 + 100.0)
    a, b = (lon1 - lon0) / 100.0, (lon2 - lon0) / 100.0
    c, d = (lat1 - lat0) / 100.0, (lat2 - lat0) / 100.0
    return lambda x, y: (lon0 + a * (x - x0) + b * (y - y0), lat0 + c * (x - x0) + d * (y - y0))


def _polygons(geometry, project) -> dict[str, Any] | None:
    kind, coordinates = geometry
    parts = [coordinates] if kind == "Polygon" else coordinates if kind == "MultiPolygon" else []
    parts = [part for part in parts if part and part[0]]
    if not parts:
        return None
    project = _local(project, parts)
    polygons = [p for p in (_polygon(part, project) for part in parts) if p]
    if not polygons:
        return None
    if len(polygons) == 1:
        return {"type": "Polygon", "coordinates": polygons[0]}
    return {"type": "MultiPolygon", "coordinates": polygons}


def _point(geometry, project) -> dict[str, Any] | None:
    kind, coordinates = geometry
    if kind == "Point":
        x, y = coordinates
    elif kind == "MultiPoint" and coordinates:
        x, y = coordinates[0]
    else:
        return None
    lon, lat = project(x, y)
    return {"type": "Point", "coordinates": [round(lon, DIGITS), round(lat, DIGITS)]}


def _rows(connection: sqlite3.Connection, table: str, columns: str) -> Iterator[tuple]:
    exists = connection.execute("SELECT 1 FROM gpkg_contents WHERE table_name = ?", (table,)).fetchone()
    if not exists:
        return iter(())
    return connection.execute(f'SELECT geom, {columns} FROM "{table}"')


def convert_geopackage(path: Path, writer: ChunkWriter, prefixes: tuple[str, ...] | None = None) -> None:
    """Reads the census tables of a GeoPackage into the chunk cache.

    `prefixes` limits the national package to the given province codes (development runs).
    """
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    connection.text_factory = lambda value: value.decode("utf-8", "replace")
    srs = {table: srs_id for table, srs_id in connection.execute("SELECT table_name, srs_id FROM gpkg_contents")}
    projectors: dict[int, Callable] = {}

    def project_for(table: str):
        srs_id = srs.get(table, 31992)
        if srs_id not in projectors:
            projectors[srs_id] = geo.projector(srs_id)
        return projectors[srs_id]

    def wanted(code: str | None) -> bool:
        return prefixes is None or bool(code) and code[:2] in prefixes

    project = project_for("ejes_l")
    for blob, kind, name, parish, parish_name in _rows(connection, "ejes_l", "tipo_eje, nom_eje, parroquia, nom_par"):
        if not wanted(parish):
            continue
        geometry = geo.parse_gpkg_geometry(blob)
        if not geometry:
            continue
        parts = [geometry[1]] if geometry[0] == "LineString" else geometry[1] if geometry[0] == "MultiLineString" else []
        for part in parts:
            line = _line(part, project)
            if line:
                writer.write("streets", {"type": "LineString", "coordinates": line},
                             {"k": _text(kind), "n": _text(name), "p": _text(parish), "pn": _text(parish_name)})

    project = project_for("aream_a")
    for blob, name, kind, parish, zone in _rows(connection, "aream_a", "nom_aman, tipo_aream, parroq, zon"):
        if not wanted(parish):
            continue
        geometry = geo.parse_gpkg_geometry(blob)
        polygons = _polygons(geometry, project) if geometry else None
        if polygons:
            writer.write("areas", polygons, {"n": _text(name), "t": _text(kind), "p": _text(parish), "z": _text(zone)})

    project = project_for("man_a")
    for blob, block in _rows(connection, "man_a", "man"):
        if not wanted(block):
            continue
        geometry = geo.parse_gpkg_geometry(blob)
        polygons = _polygons(geometry, project) if geometry else None
        if polygons:
            writer.write("blocks", polygons, {"m": _text(block)})

    project = project_for("ca04_a")
    for blob, block, category, name in _rows(connection, "ca04_a", "man, cod_otros, nom_edif"):
        if not wanted(block):
            continue
        geometry = geo.parse_gpkg_geometry(blob)
        polygons = _polygons(geometry, project) if geometry else None
        if not polygons:
            continue
        category = _text(category)
        if category in LANDUSE_CATEGORIES:
            writer.write("landuse", polygons, {"c": category, "n": _text(name)})
        else:
            writer.write("buildings", polygons, {"c": category} if category else {})

    project = project_for("loc_p")
    for blob, name, main, code in _rows(connection, "loc_p", "n_loc, principal, loc"):
        if not wanted(code):
            continue
        geometry = geo.parse_gpkg_geometry(blob)
        point = _point(geometry, project) if geometry else None
        if point and _text(name):
            writer.write("localities", point, {"n": _text(name), "pr": _text(main), "c": _text(code)})

    project = project_for("edif_p")
    for blob, name, category, block in _rows(connection, "edif_p", "nom_edif, cod_otros, man"):
        if not wanted(block):
            continue
        name = _text(name)
        category = _text(category)
        if not name and category not in {"PARQUE", "GASOLINERA", "CEMENTERIO", "PLAZA"}:
            continue
        geometry = geo.parse_gpkg_geometry(blob)
        point = _point(geometry, project) if geometry else None
        if point:
            writer.write("landmarks", point, {"n": name, "c": category, "m": _text(block)})

    if prefixes is None or len(prefixes) > 1:
        project = project_for("malla_ge_a")
        for blob, code, homes, people in _rows(connection, "malla_ge_a", "codigo, viv_sum, pob_sum"):
            if not people or float(people) <= 0:
                continue
            geometry = geo.parse_gpkg_geometry(blob)
            if not geometry:
                continue
            polygons = geometry[1] if geometry[0] == "MultiPolygon" else [geometry[1]]
            ring = polygons[0][0]
            _, cx, cy = geo.ring_area_centroid(ring)
            lon, lat = project(cx, cy)
            writer.write("population", {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
                         {"pop": int(float(people)), "viv": int(float(homes or 0)), "c": _text(code)})
    connection.close()


# ---------------------------------------------------------------- orchestration


def chunk_ids(source: dict[str, Any]) -> list[str]:
    return list(source.get("provinces") or PROVINCES.keys())


def chunk_url(source: dict[str, Any], chunk: str) -> str:
    base = source.get("url", BASE_URL).rstrip("/") + "/"
    if chunk == "national":
        return base + source.get("nationalFile", NATIONAL_FILE)
    return f"{base}{chunk}_{PROVINCES[chunk]}.zip"


def ingest(source: dict[str, Any], destination: Path, force: bool, user_agent: str) -> dict[str, Any]:
    """Refreshes the chunk cache; returns per-chunk fingerprints and counts.

    INEC_GPKG_FILE=<national .gpkg> converts a local copy instead (development, offline runs).
    """
    cache = destination / "inec"
    cache.mkdir(parents=True, exist_ok=True)
    local = os.environ.get("INEC_GPKG_FILE")
    report: dict[str, Any] = {"chunks": {}}
    if local:
        path = Path(local)
        fingerprint = f"local|{path.stat().st_size}|{int(path.stat().st_mtime)}"
        directory = cache / "national"
        if not force and _cached(directory, fingerprint):
            log("national package unchanged (local copy)")
        else:
            _clear_other_chunks(cache, keep={"national"})
            writer = ChunkWriter(directory)
            try:
                log(f"converting local package {path}")
                convert_geopackage(path, writer)
                writer.commit({"version": CACHE_VERSION, "fingerprint": fingerprint, "source": str(path)})
            except BaseException:
                writer.abort()
                raise
        report["chunks"]["national"] = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
        return report

    chunks = chunk_ids(source)
    if source.get("populationFromNational", True):
        chunks = chunks + ["population"]
    _clear_other_chunks(cache, keep=set(chunks))
    for chunk in chunks:
        url = chunk_url(source, "national" if chunk == "population" else chunk)
        directory = cache / chunk
        try:
            fingerprint = remote_fingerprint(url, user_agent)
        except RuntimeError:
            if _cached(directory, None):
                log(f"{chunk}: source unreachable, keeping the cached copy")
                report["chunks"][chunk] = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
                continue
            raise
        if not force and _cached(directory, fingerprint):
            report["chunks"][chunk] = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
            continue
        if chunk == "population" and not _enough_disk(cache, 7 << 30):
            if _cached(directory, None):
                log("population grid: not enough disk for the national package, keeping the cached grid")
                report["chunks"][chunk] = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
                continue
            log("population grid: skipped (the national package needs about 7 GB of free disk)")
            continue
        work = Path(tempfile.mkdtemp(prefix=".inec-download-", dir=cache))
        writer = ChunkWriter(directory)
        try:
            log(f"{chunk}: downloading {url}")
            archive = work / Path(url).name
            checksum = download(url, archive, user_agent)
            with zipfile.ZipFile(archive) as bundle:
                broken = bundle.testzip()
                if broken:
                    raise RuntimeError(f"{archive.name}: corrupt member {broken}")
            package = extract_geopackage(archive, work)
            archive.unlink()
            log(f"{chunk}: converting {package.name}")
            if chunk == "population":
                _convert_population_only(package, writer)
            else:
                convert_geopackage(package, writer)
            writer.commit({"version": CACHE_VERSION, "fingerprint": fingerprint, "sha256": checksum, "url": url})
        except BaseException:
            writer.abort()
            raise
        finally:
            shutil.rmtree(work, ignore_errors=True)
        report["chunks"][chunk] = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
        log(f"{chunk}: {report['chunks'][chunk]['counts']}")
    return report


def _convert_population_only(package: Path, writer: ChunkWriter) -> None:
    connection = sqlite3.connect(f"file:{package}?mode=ro", uri=True)
    srs_id = dict(connection.execute("SELECT table_name, srs_id FROM gpkg_contents")).get("malla_ge_a", 31992)
    project = geo.projector(srs_id)
    for blob, code, homes, people in _rows(connection, "malla_ge_a", "codigo, viv_sum, pob_sum"):
        if not people or float(people) <= 0:
            continue
        geometry = geo.parse_gpkg_geometry(blob)
        if not geometry:
            continue
        polygons = geometry[1] if geometry[0] == "MultiPolygon" else [geometry[1]]
        _, cx, cy = geo.ring_area_centroid(polygons[0][0])
        lon, lat = project(cx, cy)
        writer.write("population", {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
                     {"pop": int(float(people)), "viv": int(float(homes or 0)), "c": _text(code)})
    connection.close()


def _cached(directory: Path, fingerprint: str | None) -> bool:
    meta = directory / "meta.json"
    if not meta.exists():
        return False
    data = json.loads(meta.read_text(encoding="utf-8"))
    if data.get("version") != CACHE_VERSION:
        return False
    if fingerprint is not None and data.get("fingerprint") != fingerprint:
        return False
    return all((directory / f"{name}.ndjson.gz").exists() for name in LAYERS)


def _clear_other_chunks(cache: Path, keep: set[str]) -> None:
    for child in cache.iterdir():
        if child.is_dir() and not child.name.startswith(".") and child.name not in keep:
            shutil.rmtree(child)
        elif child.name.startswith(".inec-"):
            shutil.rmtree(child, ignore_errors=True)


def _enough_disk(path: Path, required: int) -> bool:
    return shutil.disk_usage(path).free >= required


def features(destination: Path, layer: str) -> Iterable[dict[str, Any]]:
    """Every cached feature of a layer, chunk after chunk."""
    cache = destination / "inec"
    if not cache.exists():
        return
    for directory in sorted(child for child in cache.iterdir() if child.is_dir() and not child.name.startswith(".")):
        path = directory / f"{layer}.ndjson.gz"
        if not path.exists():
            continue
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    yield json.loads(line)
