"""Relief: elevation tiles in the Terrarium encoding, rendered from the Copernicus DEM.

MapLibre draws the relief of the platform (hillshading, elevation colours and 3D terrain) from these
tiles. The source is the Copernicus DEM GLO-30 (1 arc second, ~30 m), published as 1 x 1 degree
GeoTIFFs named after their south-west corner; the tiles that exist are listed in tileList.txt
(open sea has none).
"""

from __future__ import annotations

import io
import math
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np

from . import tiling
from .tiling import BBox, Tile

#: Elevation encoding understood by MapLibre (`"encoding": "terrarium"` in raster-dem sources):
#: height = R * 256 + G + B / 256 - 32768 metres.
TERRARIUM_OFFSET = 32768.0
EQUATOR_METRES = 2 * tiling.HALF_WORLD


def dem_tile_name(lat: int, lon: int, code: str = "10") -> str:
    """Name of the Copernicus DEM tile whose south-west corner is (lat, lon); code 10 is GLO-30 and
    30 is GLO-90."""
    north = f"N{lat:02d}" if lat >= 0 else f"S{-lat:02d}"
    east = f"E{lon:03d}" if lon >= 0 else f"W{-lon:03d}"
    return f"Copernicus_DSM_COG_{code}_{north}_00_{east}_00_DEM"


def dem_tiles_for(bbox: BBox, available: Iterable[str], code: str = "10") -> list[str]:
    """Names of the existing DEM tiles that intersect `bbox`."""
    west, south, east, north = bbox
    existing = set(available)
    names = []
    for lat in range(math.floor(south), math.ceil(north)):
        for lon in range(math.floor(west), math.ceil(east)):
            name = dem_tile_name(lat, lon, code)
            if name in existing:
                names.append(name)
    return names


def dem_tile_bounds(name: str) -> tuple[float, float, float, float]:
    """(west, south, east, north) of a DEM tile, from its name."""
    parts = name.split("_")
    lat = int(parts[4][1:]) * (1 if parts[4][0] == "N" else -1)
    lon = int(parts[6][1:]) * (1 if parts[6][0] == "E" else -1)
    return lon, lat, lon + 1, lat + 1


def quantum(zoom: int) -> float:
    """Vertical step, in metres, the heights of a zoom are rounded to: a power of two near 1/200 of the
    pixel size, far below what hillshading can show, so the tiles compress much better."""
    pixel = EQUATOR_METRES / (tiling.TILE_SIZE * 2 ** zoom)
    return float(2.0 ** max(-8, min(5, math.floor(math.log2(pixel / 200)))))


def terrarium_encode(heights: np.ndarray, step: float = 1 / 256) -> np.ndarray:
    """RGB image (uint8, H x W x 3) of heights in metres; NaN is sea level."""
    clean = np.nan_to_num(heights.astype(np.float64), nan=0.0)
    clean = np.clip(np.round(clean / step) * step, -TERRARIUM_OFFSET + 1, 32767)
    value = np.round((clean + TERRARIUM_OFFSET) * 256).astype(np.int64)
    rgb = np.empty((*heights.shape, 3), dtype=np.uint8)
    rgb[..., 0] = value >> 16
    rgb[..., 1] = (value >> 8) & 0xFF
    rgb[..., 2] = value & 0xFF
    return rgb


def terrarium_decode(rgb: np.ndarray) -> np.ndarray:
    channels = rgb.astype(np.float64)
    return channels[..., 0] * 256 + channels[..., 1] + channels[..., 2] / 256 - TERRARIUM_OFFSET


def encode_webp(rgb: np.ndarray, lossless: bool, quality: int) -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    image = Image.fromarray(rgb, "RGB")
    if lossless:
        image.save(buffer, "WEBP", lossless=True, quality=quality, method=5, exact=True)
    else:
        image.save(buffer, "WEBP", quality=quality, method=5)
    return buffer.getvalue()


class TerrainLayer(tiling.RasterLayer):
    """Heights resampled from local copies of the DEM tiles (`sources`: name -> GeoTIFF path)."""

    tile_type = tiling.TileType.WEBP

    def __init__(self, sources: dict[str, Path], metadata: dict[str, Any]):
        self.sources = {name: (path, dem_tile_bounds(name)) for name, path in sources.items()}
        self.metadata = {"encoding": "terrarium", **metadata}
        self._datasets: dict[str, Any] = {}

    def _dataset(self, name: str) -> Any:
        # Opened lazily, so every worker process has its own handles.
        import rasterio

        dataset = self._datasets.get(name)
        if dataset is None:
            dataset = self._datasets[name] = rasterio.open(self.sources[name][0])
        return dataset

    def covers(self, bounds: BBox) -> bool:
        return any(tiling.intersects(bounds, extent) for _, extent in self.sources.values())

    def leaf(self, zoom: int, x: int, y: int) -> Tile:
        import rasterio
        from rasterio.enums import Resampling
        from rasterio.transform import from_bounds
        from rasterio.warp import reproject

        size = tiling.TILE_SIZE
        bounds = tiling.lonlat_bounds(zoom, x, y)
        # A margin of a few source pixels keeps the resampling continuous across DEM tiles.
        margin = 0.002
        wide = (bounds[0] - margin, bounds[1] - margin, bounds[2] + margin, bounds[3] + margin)
        transform = from_bounds(*tiling.mercator_bounds(zoom, x, y), size, size)
        pixel = EQUATOR_METRES / (size * 2 ** zoom)
        heights = np.full((size, size), np.nan, dtype=np.float32)
        for name, (_, extent) in self.sources.items():
            if not tiling.intersects(wide, extent):
                continue
            dataset = self._dataset(name)
            source_pixel = abs(dataset.res[0]) * 111_320
            part = np.full((size, size), np.nan, dtype=np.float32)
            reproject(
                source=rasterio.band(dataset, 1), destination=part,
                dst_transform=transform, dst_crs="EPSG:3857", dst_nodata=np.nan,
                src_nodata=dataset.nodata,
                resampling=Resampling.average if pixel > 1.5 * source_pixel else Resampling.bilinear,
            )
            np.copyto(heights, part, where=np.isnan(heights))
        if np.isnan(heights).all():
            return None
        return heights

    def reduce(self, parts: Sequence[Tile]) -> Tile:
        size = tiling.TILE_SIZE
        joined = tiling.mosaic(parts, np.nan, (size, size), np.float32)
        valid = ~np.isnan(joined)
        mean, weight = tiling.block_mean(np.nan_to_num(joined), valid)
        if not (weight > 0).any():
            return None
        mean[weight == 0] = np.nan
        return mean.astype(np.float32)

    def encode(self, tile: np.ndarray, zoom: int) -> bytes:
        return encode_webp(terrarium_encode(tile, quantum(zoom)), lossless=True, quality=100)
