"""Raster tile pyramids (Web Mercator, 512 px tiles) written to PMTiles archives.

The relief (elevation) and satellite layers of the platform are raster tiles built here from openly
licensed sources. A `RasterLayer` renders the tiles of the highest zoom from its sources (`leaf`);
every lower zoom is averaged from its four children (`reduce`), so each source pixel is read once.
The work is split in subtrees that run in parallel processes; encoded tiles go to a temporary SQLite
file and are then written to the archive sorted by tile id (a clustered archive), identical tiles
(open sea, empty land) stored once.

Needs numpy and the `pmtiles` package: the data-tools image installs them with the other raster
dependencies in /opt/raster (see its Dockerfile).
"""

from __future__ import annotations

import math
import os
import sqlite3
import sys
import tempfile
import time
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait
from multiprocessing import get_context
from pathlib import Path
from typing import Any, Iterator, Optional, Sequence

import numpy as np
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

#: Half the width of the Web Mercator world, in metres (EPSG:3857).
HALF_WORLD = 20037508.342789244
#: Pixels per tile side. MapLibre draws a 512 px tile of zoom z at zoom z (256 px tiles at z - 1).
TILE_SIZE = 512
MAX_LATITUDE = 85.0511287798066

BBox = Sequence[float]
Tile = Optional[np.ndarray]


def log(message: str) -> None:
    print(f"[tiles] {message}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------- tile grid

def lonlat_to_tile(lon: float, lat: float, zoom: int) -> tuple[float, float]:
    """Fractional tile coordinates of a point (x to the east, y to the south)."""
    scale = 2 ** zoom
    lat = max(-MAX_LATITUDE, min(MAX_LATITUDE, lat))
    x = (lon + 180.0) / 360.0 * scale
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * scale
    return x, y


def tile_range(bbox: BBox, zoom: int) -> tuple[int, int, int, int]:
    """Inclusive (min x, min y, max x, max y) of the tiles of `zoom` that intersect `bbox`."""
    west, south, east, north = bbox
    last = 2 ** zoom - 1
    x0, y0 = lonlat_to_tile(west, north, zoom)
    x1, y1 = lonlat_to_tile(east, south, zoom)
    clamp = lambda value: min(max(value, 0), last)  # noqa: E731
    return (clamp(math.floor(x0)), clamp(math.floor(y0)),
            clamp(math.ceil(x1) - 1), clamp(math.ceil(y1) - 1))


def tiles_in(bbox: BBox, zoom: int) -> Iterator[tuple[int, int]]:
    x0, y0, x1, y1 = tile_range(bbox, zoom)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            yield x, y


def tile_count(bbox: BBox, zoom: int) -> int:
    x0, y0, x1, y1 = tile_range(bbox, zoom)
    return (x1 - x0 + 1) * (y1 - y0 + 1)


def mercator_bounds(zoom: int, x: int, y: int) -> tuple[float, float, float, float]:
    """(min x, min y, max x, max y) of a tile in EPSG:3857 metres."""
    size = 2 * HALF_WORLD / 2 ** zoom
    left = -HALF_WORLD + x * size
    top = HALF_WORLD - y * size
    return left, top - size, left + size, top


def lonlat_bounds(zoom: int, x: int, y: int) -> tuple[float, float, float, float]:
    """(west, south, east, north) of a tile in degrees."""
    scale = 2 ** zoom

    def latitude(row: float) -> float:
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * row / scale))))

    return x / scale * 360.0 - 180.0, latitude(y + 1), (x + 1) / scale * 360.0 - 180.0, latitude(y)


def intersects(a: BBox, b: BBox) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def children(zoom: int, x: int, y: int) -> list[tuple[int, int, int]]:
    """The four tiles of the next zoom, in the order north-west, north-east, south-west, south-east."""
    return [(zoom + 1, 2 * x, 2 * y), (zoom + 1, 2 * x + 1, 2 * y),
            (zoom + 1, 2 * x, 2 * y + 1), (zoom + 1, 2 * x + 1, 2 * y + 1)]


def mosaic(parts: Sequence[Tile], fill: Any, shape: tuple[int, ...], dtype: Any) -> np.ndarray:
    """2 x 2 mosaic of the children (see `children`); missing ones are filled with `fill`."""
    size = shape[0]
    out = np.full((2 * size, 2 * size, *shape[2:]), fill, dtype=dtype)
    for index, part in enumerate(parts):
        if part is None:
            continue
        row, column = divmod(index, 2)
        out[row * size:(row + 1) * size, column * size:(column + 1) * size] = part
    return out


def block_mean(values: np.ndarray, weights: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Mean of every 2 x 2 block (halves each side). With `weights` (0 where there is no data), the
    mean is weighted and the second result is the summed weight; otherwise it is the block count."""
    height, width = values.shape[:2]
    shape = (height // 2, 2, width // 2, 2, *values.shape[2:])
    blocks = values.reshape(shape).astype(np.float64)
    if weights is None:
        return blocks.mean(axis=(1, 3)), np.full(shape[:1] + shape[2:3], 4.0)
    weight = weights.reshape(shape[:4]).astype(np.float64)
    total = weight.sum(axis=(1, 3))
    if values.ndim == 3:
        summed = (blocks * weight[..., None]).sum(axis=(1, 3))
        mean = np.divide(summed, total[..., None], out=np.zeros_like(summed), where=total[..., None] > 0)
    else:
        summed = (blocks * weight).sum(axis=(1, 3))
        mean = np.divide(summed, total, out=np.zeros_like(summed), where=total > 0)
    return mean, total


# ---------------------------------------------------------------- layers

class RasterLayer:
    """A raster layer rendered from its sources. Subclasses implement `leaf`, `reduce` and `encode`."""

    #: PMTiles tile type of the encoded tiles.
    tile_type = TileType.PNG
    #: Extra metadata written into the archive (name, attribution, encoding...).
    metadata: dict[str, Any] = {}

    def covers(self, bounds: BBox) -> bool:
        """Whether any source has data inside `bounds` (west, south, east, north). Tiles that cover
        no source are skipped without reading anything."""
        return True

    def leaf(self, zoom: int, x: int, y: int) -> Tile:
        """The tile of the highest zoom, read from the sources; None where there is no data."""
        raise NotImplementedError

    def reduce(self, parts: Sequence[Tile]) -> Tile:
        """The parent of four tiles (see `children`); None when all four are None."""
        raise NotImplementedError

    def encode(self, tile: np.ndarray, zoom: int) -> bytes:
        raise NotImplementedError


# ---------------------------------------------------------------- building

_LAYER: RasterLayer | None = None  # inherited by the worker processes (fork)
_MAX_ZOOM = 0


def _subtree(zoom: int, x: int, y: int) -> tuple[int, int, Tile, list[tuple[int, bytes]]]:
    """Renders a tile and everything below it; returns the tile and the encoded tiles of the subtree."""
    layer = _LAYER
    assert layer is not None
    encoded: list[tuple[int, bytes]] = []

    def render(z: int, tx: int, ty: int) -> Tile:
        if not layer.covers(lonlat_bounds(z, tx, ty)):
            return None
        if z == _MAX_ZOOM:
            tile = layer.leaf(z, tx, ty)
        else:
            tile = layer.reduce([render(*child) for child in children(z, tx, ty)])
        if tile is not None:
            encoded.append((zxy_to_tileid(z, tx, ty), layer.encode(tile, z)))
        return tile

    root = render(zoom, x, y)
    return x, y, root, encoded


def split_zoom(bbox: BBox, min_zoom: int, max_zoom: int, workers: int) -> int:
    """Zoom whose tiles are handed to the workers: the first one with enough tiles to share."""
    for zoom in range(min_zoom, max_zoom + 1):
        if tile_count(bbox, zoom) >= 4 * workers:
            return zoom
    return max_zoom


def build_archive(layer: RasterLayer, bbox: BBox, min_zoom: int, max_zoom: int, output: Path,
                  name: str, workers: int | None = None) -> dict[str, Any]:
    """Renders `layer` over `bbox` from `min_zoom` to `max_zoom` into the PMTiles archive `output`
    (written next to it and renamed when complete). Returns a summary of the archive."""
    global _LAYER, _MAX_ZOOM
    started = time.time()
    workers = max(1, workers or os.cpu_count() or 1)
    split = split_zoom(bbox, min_zoom, max_zoom, workers)
    roots = [(split, x, y) for x, y in tiles_in(bbox, split) if layer.covers(lonlat_bounds(split, x, y))]
    log(f"{name}: zooms {min_zoom}-{max_zoom}, {len(roots)} subtrees from zoom {split}, {workers} workers")

    output.parent.mkdir(parents=True, exist_ok=True)
    scratch = tempfile.mkdtemp(prefix=".tiles-", dir=output.parent)
    store_path = Path(scratch) / "tiles.sqlite"
    store = sqlite3.connect(store_path)
    store.execute("PRAGMA journal_mode = OFF")
    store.execute("PRAGMA synchronous = OFF")
    store.execute("CREATE TABLE tiles (id INTEGER PRIMARY KEY, data BLOB NOT NULL)")
    level: dict[tuple[int, int], np.ndarray] = {}
    done = 0
    try:
        _LAYER, _MAX_ZOOM = layer, max_zoom
        if workers == 1 or len(roots) <= 1:
            results = (_subtree(*root) for root in roots)
            for x, y, tile, encoded in results:
                store.executemany("INSERT INTO tiles VALUES (?, ?)", encoded)
                if tile is not None:
                    level[(x, y)] = tile
        else:
            with ProcessPoolExecutor(workers, mp_context=get_context("fork")) as pool:
                pending = {pool.submit(_subtree, *root) for root in roots}
                while pending:
                    finished, pending = wait(pending, return_when=FIRST_COMPLETED)
                    for future in finished:
                        x, y, tile, encoded = future.result()
                        store.executemany("INSERT INTO tiles VALUES (?, ?)", encoded)
                        if tile is not None:
                            level[(x, y)] = tile
                        done += 1
                        if done % max(1, len(roots) // 20) == 0:
                            log(f"{name}: {done}/{len(roots)} subtrees ({time.time() - started:.0f} s)")
        store.commit()
        # Zooms below the split, from the subtree roots.
        for zoom in range(split - 1, min_zoom - 1, -1):
            upper: dict[tuple[int, int], np.ndarray] = {}
            for x, y in tiles_in(bbox, zoom):
                parts = [level.get((cx, cy)) for _, cx, cy in children(zoom, x, y)]
                if all(part is None for part in parts):
                    continue
                tile = layer.reduce(parts)
                if tile is None:
                    continue
                upper[(x, y)] = tile
                store.execute("INSERT INTO tiles VALUES (?, ?)", (zxy_to_tileid(zoom, x, y), layer.encode(tile, zoom)))
            level = upper
        store.commit()
        summary = _write_pmtiles(store, layer, bbox, min_zoom, max_zoom, output, name)
    finally:
        _LAYER = None
        store.close()
        for leftover in Path(scratch).glob("*"):
            leftover.unlink()
        os.rmdir(scratch)
    summary["seconds"] = round(time.time() - started)
    log(f"{name}: {summary['tiles']} tiles ({summary['unique']} distinct), "
        f"{summary['bytes'] / 1e6:.1f} MB in {summary['seconds']} s")
    return summary


def _write_pmtiles(store: sqlite3.Connection, layer: RasterLayer, bbox: BBox, min_zoom: int, max_zoom: int,
                   output: Path, name: str) -> dict[str, Any]:
    count = store.execute("SELECT count(*) FROM tiles").fetchone()[0]
    if count == 0:
        raise RuntimeError(f"{name}: no tile has data inside {list(bbox)}")
    temporary = output.with_name(f".{output.name}.part")
    west, south, east, north = bbox
    header = {
        "tile_type": layer.tile_type,
        "tile_compression": Compression.NONE,  # PNG, WebP and JPEG are already compressed
        "min_lon_e7": int(west * 1e7), "min_lat_e7": int(south * 1e7),
        "max_lon_e7": int(east * 1e7), "max_lat_e7": int(north * 1e7),
        "center_zoom": min(max_zoom, max(min_zoom, 7)),
        "center_lon_e7": int((west + east) / 2 * 1e7), "center_lat_e7": int((south + north) / 2 * 1e7),
    }
    metadata = {"name": name, "format": layer.tile_type.name.lower(), "type": "baselayer",
                "minzoom": min_zoom, "maxzoom": max_zoom, "bounds": list(bbox), **layer.metadata}
    try:
        with temporary.open("wb") as handle:
            writer = Writer(handle)
            for tile_id, data in store.execute("SELECT id, data FROM tiles ORDER BY id"):
                writer.write_tile(tile_id, bytes(data))
            writer.finalize(header, metadata)
            unique = len(writer.hash_to_offset)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output)
        os.chmod(output, 0o644)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return {"tiles": count, "unique": unique, "bytes": output.stat().st_size, "minZoom": min_zoom,
            "maxZoom": max_zoom, "bounds": list(bbox), "format": metadata["format"]}


def read_header(path: Path) -> dict[str, Any]:
    """Zooms, bounds and tile type of a PMTiles archive (for the region manifests)."""
    from pmtiles.tile import deserialize_header

    with path.open("rb") as handle:
        header = deserialize_header(handle.read(127))
    return {
        "minZoom": header["min_zoom"],
        "maxZoom": header["max_zoom"],
        "bbox": [header["min_lon_e7"] / 1e7, header["min_lat_e7"] / 1e7,
                 header["max_lon_e7"] / 1e7, header["max_lat_e7"] / 1e7],
        "format": header["tile_type"].name.lower(),
    }
