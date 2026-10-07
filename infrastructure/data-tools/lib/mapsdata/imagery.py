"""Satellite view: colour tiles rendered from the ESA WorldCover Sentinel-2 composites.

ESA publishes, under CC BY 4.0, the cloud-free yearly composites of Sentinel-2 it made for WorldCover:
10 m surface reflectance (red, green, blue, near infrared) in 1 x 1 degree Cloud Optimized GeoTIFFs
named after their south-west corner, with overviews at 20, 40, 80 and 160 m. The platform reads the
part of each composite a region needs, at the resolution its highest zoom needs (`fetch_cell`), fills
the gaps of the latest year with the previous one, turns reflectance into natural colour and closes
the small holes left by clouds and snow (`prepare_cell`), then renders WebP tiles (`ImageryLayer`).
"""

from __future__ import annotations

import io
import math
from pathlib import Path
from typing import Any, Iterator, Sequence

import numpy as np

from . import tiling
from .tiling import BBox, Tile

#: Composites in order of preference: gaps of the first one are filled with the next ones.
YEARS = ((2021, "v200"), (2020, "v100"))
#: Size of a composite pixel, in degrees and (at the equator) in metres.
NATIVE_DEGREES = 1 / 12000
NATIVE_METRES = NATIVE_DEGREES * 111_320
#: Overview factors of the composites (1 is the full resolution).
FACTORS = (1, 2, 4, 8, 16)
#: Rows and columns processed at a time, so memory stays bounded whatever the region.
CHUNK = 2048
#: Holes up to about twice this size are painted from their surroundings (clouds, snowy peaks);
#: bigger ones (open sea) stay transparent.
FILL_METRES = 2500

# Natural colour from surface reflectance (0-10000): gain, gamma and a little extra saturation.
GAIN = 3.0
GAMMA = 1.7
SATURATION = 1.35


def cell_name(lat: int, lon: int) -> str:
    north = f"N{lat:02d}" if lat >= 0 else f"S{-lat:02d}"
    east = f"E{lon:03d}" if lon >= 0 else f"W{-lon:03d}"
    return north + east


def cell_url(base: str, year: int, version: str, lat: int, lon: int) -> str:
    name = cell_name(lat, lon)
    return f"{base}/rgbnir/{year}/{name[:3]}/ESA_WorldCover_10m_{year}_{version}_{name}_S2RGBNIR.tif"


def cells_for(bbox: BBox) -> list[tuple[int, int]]:
    """(lat, lon) of the south-west corner of every 1 x 1 degree cell that intersects `bbox`."""
    west, south, east, north = bbox
    return [(lat, lon) for lat in range(math.floor(south), math.ceil(north))
            for lon in range(math.floor(west), math.ceil(east))]


def cell_bounds(lat: int, lon: int) -> tuple[float, float, float, float]:
    return float(lon), float(lat), float(lon + 1), float(lat + 1)


def overview_factor(max_zoom: int) -> int:
    """Coarsest overview that is still at least as detailed as the tiles of `max_zoom`."""
    pixel = 2 * tiling.HALF_WORLD / (tiling.TILE_SIZE * 2 ** max_zoom)
    return max(factor for factor in FACTORS if factor == 1 or NATIVE_METRES * factor <= pixel)


def chunks(width: int, height: int, size: int = CHUNK, margin: int = 0) -> Iterator[tuple[Any, Any]]:
    """(read window with margin, inner window) pairs that cover a width x height raster."""
    from rasterio.windows import Window

    for row in range(0, height, size):
        for column in range(0, width, size):
            inner = Window(column, row, min(size, width - column), min(size, height - row))
            top, left = max(0, row - margin), max(0, column - margin)
            bottom = min(height, row + inner.height + margin)
            right = min(width, column + inner.width + margin)
            yield Window(left, top, right - left, bottom - top), inner


def fetch_cell(urls: Sequence[str], bbox: BBox, factor: int, target: Path) -> dict[str, Any]:
    """Reads red, green and blue of `urls[0]` inside `bbox` (clipped to the cell) at 1/`factor` of the
    full resolution, fills its gaps with the following composites and writes them to `target`
    (uint16 GeoTIFF, 0 = no data). Returns what was read, for the source manifest."""
    import rasterio
    from rasterio.windows import from_bounds

    options = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                   GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="3", VSI_CACHE="TRUE")
    with rasterio.Env(**options):
        datasets = []
        try:
            for url in urls:
                path = url if url.startswith("/") else f"/vsicurl/{url}"
                kwargs = {} if factor == 1 else {"overview_level": FACTORS.index(factor) - 1}
                datasets.append(rasterio.open(path, **kwargs))
            primary = datasets[0]
            west, south, east, north = bbox
            cw, cs, ce, cn = primary.bounds
            window = from_bounds(max(west, cw), max(south, cs), min(east, ce), min(north, cn), primary.transform)
            window = window.round_offsets(op="floor").round_lengths(op="ceil")
            window = window.intersection(rasterio.windows.Window(0, 0, primary.width, primary.height))
            transform = primary.window_transform(window)
            profile = {
                "driver": "GTiff", "width": int(window.width), "height": int(window.height), "count": 3,
                "dtype": "uint16", "crs": primary.crs, "transform": transform, "nodata": 0,
                "compress": "deflate", "predictor": 2, "tiled": True, "blockxsize": 512, "blockysize": 512,
                "BIGTIFF": "IF_SAFER",
            }
            filled = 0
            temporary = target.with_name(f".{target.name}.part")
            target.parent.mkdir(parents=True, exist_ok=True)
            with rasterio.open(temporary, "w", **profile) as output:
                for part, _ in chunks(int(window.width), int(window.height)):
                    source = rasterio.windows.Window(window.col_off + part.col_off, window.row_off + part.row_off,
                                                     part.width, part.height)
                    data = primary.read([1, 2, 3], window=source)
                    for fallback in datasets[1:]:
                        missing = (data == 0).all(axis=0)
                        if not missing.any():
                            break
                        extra = fallback.read([1, 2, 3], window=source)
                        data[:, missing] = extra[:, missing]
                        filled += int((missing & (extra != 0).any(axis=0)).sum())
                    output.write(data, window=part)
            temporary.replace(target)
        finally:
            for dataset in datasets:
                dataset.close()
    return {"width": profile["width"], "height": profile["height"], "factor": factor,
            "bounds": _bounds(transform, profile["width"], profile["height"]), "pixelsFromFallback": filled}


def _bounds(transform: Any, width: int, height: int) -> list[float]:
    west, north = transform.c, transform.f
    east, south = west + transform.a * width, north + transform.e * height
    return [round(west, 7), round(south, 7), round(east, 7), round(north, 7)]


def develop(raw: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Natural colour (3 x H x W uint8) and validity mask of surface reflectance (3 x H x W uint16)."""
    valid = (raw != 0).any(axis=0)
    reflectance = raw.astype(np.float32) / 10000.0
    colour = np.clip(reflectance * GAIN, 0.0, 1.0) ** (1.0 / GAMMA)
    luminance = 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2]
    colour = np.clip(luminance + (colour - luminance) * SATURATION, 0.0, 1.0)
    rgb = np.round(colour * 255).astype(np.uint8)
    rgb[:, ~valid] = 0
    return rgb, valid


def box_count(mask: np.ndarray, radius: int) -> np.ndarray:
    """Number of True cells in the (2 radius + 1)-wide square around every cell (outside counts as False)."""
    width = 2 * radius + 1
    counts = np.cumsum(np.pad(mask.astype(np.int32), ((0, 0), (radius + 1, radius))), axis=1)
    rows = counts[:, width:] - counts[:, :-width]
    counts = np.cumsum(np.pad(rows, ((radius + 1, radius), (0, 0))), axis=0)
    return counts[width:, :] - counts[:-width, :]


def small_holes(valid: np.ndarray, radius: int) -> np.ndarray:
    """No-data cells that a morphological closing of `valid` with a square of `radius` covers: holes and
    notches up to ~2 radius across, not the open sea."""
    grown = box_count(valid, radius) > 0
    closed = box_count(~grown, radius) == 0
    return closed & ~valid


def prepare_cell(raw: Path, target: Path, fill_metres: float = FILL_METRES) -> None:
    """Natural colour RGBA GeoTIFF (alpha 0 where there is no data) of a fetched cell, with the small
    holes painted from their surroundings."""
    import rasterio
    from rasterio.fill import fillnodata

    with rasterio.open(raw) as source:
        fill_distance = max(1, round(fill_metres / (abs(source.res[0]) * 111_320)))
        profile = source.profile.copy()
        profile.pop("nodata", None)
        profile.update(count=4, dtype="uint8", photometric="RGB")
        temporary = target.with_name(f".{target.name}.part")
        with rasterio.open(temporary, "w", **profile) as output:
            for part, inner in chunks(source.width, source.height, margin=2 * fill_distance):
                rgb, valid = develop(source.read([1, 2, 3], window=part))
                if fill_distance > 0 and valid.any() and not valid.all():
                    holes = small_holes(valid, fill_distance)
                    if holes.any():
                        for band in range(3):
                            painted = fillnodata(rgb[band].copy(), mask=valid.astype(np.uint8),
                                                 max_search_distance=3 * fill_distance, smoothing_iterations=0)
                            rgb[band][holes] = painted[holes]
                        valid = valid | holes
                rgb[:, ~valid] = 0
                alpha = np.where(valid, 255, 0).astype(np.uint8)
                row, column = inner.row_off - part.row_off, inner.col_off - part.col_off
                block = np.concatenate([rgb, alpha[None]], axis=0)[
                    :, row:row + inner.height, column:column + inner.width]
                output.write(block, window=inner)
    temporary.replace(target)


def encode_webp(rgba: np.ndarray, quality: int) -> bytes:
    """WebP of an H x W x 4 tile: plain RGB when it is opaque."""
    from PIL import Image

    buffer = io.BytesIO()
    if (rgba[..., 3] == 255).all():
        Image.fromarray(np.ascontiguousarray(rgba[..., :3]), "RGB").save(buffer, "WEBP", quality=quality, method=5)
    else:
        Image.fromarray(rgba, "RGBA").save(buffer, "WEBP", quality=quality, method=5, alpha_quality=90)
    return buffer.getvalue()


class ImageryLayer(tiling.RasterLayer):
    """Colour tiles resampled from prepared cells (`cells`: name -> (RGBA GeoTIFF, lon/lat bounds))."""

    tile_type = tiling.TileType.WEBP

    def __init__(self, cells: dict[str, tuple[Path, BBox]], metadata: dict[str, Any], quality: int = 78):
        self.cells = cells
        self.metadata = dict(metadata)
        self.quality = quality
        self._datasets: dict[str, Any] = {}

    def _dataset(self, name: str) -> Any:
        import rasterio

        dataset = self._datasets.get(name)
        if dataset is None:
            dataset = self._datasets[name] = rasterio.open(self.cells[name][0])
        return dataset

    def covers(self, bounds: BBox) -> bool:
        return any(tiling.intersects(bounds, extent) for _, extent in self.cells.values())

    def leaf(self, zoom: int, x: int, y: int) -> Tile:
        import rasterio
        from rasterio.enums import Resampling
        from rasterio.transform import from_bounds
        from rasterio.warp import reproject

        size = tiling.TILE_SIZE
        bounds = tiling.lonlat_bounds(zoom, x, y)
        transform = from_bounds(*tiling.mercator_bounds(zoom, x, y), size, size)
        pixel = 2 * tiling.HALF_WORLD / (size * 2 ** zoom)
        tile = np.zeros((4, size, size), dtype=np.uint8)
        for name, (_, extent) in self.cells.items():
            if not tiling.intersects(bounds, extent):
                continue
            dataset = self._dataset(name)
            source_pixel = abs(dataset.res[0]) * 111_320
            part = np.zeros((4, size, size), dtype=np.uint8)
            # RGB is 0 wherever alpha is 0 (premultiplied), so resampling at the edges of the data
            # darkens colour and alpha alike and dividing by alpha restores the colour.
            reproject(
                source=rasterio.band(dataset, [1, 2, 3, 4]), destination=part,
                dst_transform=transform, dst_crs="EPSG:3857", src_nodata=None, dst_nodata=None,
                resampling=Resampling.average if pixel > 1.5 * source_pixel else Resampling.cubic,
            )
            take = part[3] > tile[3]
            tile[:, take] = part[:, take]
        if not tile[3].any():
            return None
        alpha = tile[3].astype(np.float32)
        colour = tile[:3].astype(np.float32) * 255.0 / np.maximum(alpha, 1.0)
        tile[:3] = np.clip(np.round(colour), 0, 255).astype(np.uint8)
        return np.ascontiguousarray(tile.transpose(1, 2, 0))

    def reduce(self, parts: Sequence[Tile]) -> Tile:
        size = tiling.TILE_SIZE
        joined = tiling.mosaic(parts, 0, (size, size, 4), np.uint8)
        alpha = joined[..., 3]
        if not alpha.any():
            return None
        colour, _ = tiling.block_mean(joined[..., :3], alpha)
        coverage, _ = tiling.block_mean(alpha)
        tile = np.empty((size, size, 4), dtype=np.uint8)
        tile[..., :3] = np.clip(np.round(colour), 0, 255)
        tile[..., 3] = np.clip(np.round(coverage), 0, 255)
        return tile

    def encode(self, tile: np.ndarray, zoom: int) -> bytes:
        return encode_webp(tile, self.quality)
