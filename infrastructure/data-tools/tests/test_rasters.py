"""Relief and satellite tiles. Needs the raster dependencies (numpy, rasterio, Pillow, pmtiles), which
the data-tools image installs in /opt/raster; without them these tests are skipped."""

import importlib.util
import io
import math
import tempfile
import unittest
from pathlib import Path

HAS_RASTER = all(importlib.util.find_spec(name) for name in ("numpy", "rasterio", "PIL", "pmtiles"))

if HAS_RASTER:
    import numpy as np
    import rasterio
    from PIL import Image
    from pmtiles.reader import MmapSource, Reader, all_tiles
    from rasterio.transform import from_origin

    from mapsdata import imagery, terrain, tiling

GUAYAQUIL = (-79.95, -2.25, -79.85, -2.15)


def geotiff(path, data, west, north, pixel, nodata=None):
    """EPSG:4326 GeoTIFF of `data` (bands x rows x columns) with its top-left corner at (west, north)."""
    bands, height, width = data.shape
    with rasterio.open(path, "w", driver="GTiff", width=width, height=height, count=bands, dtype=data.dtype,
                       crs="EPSG:4326", transform=from_origin(west, north, pixel, pixel), nodata=nodata) as out:
        out.write(data)
    return path


@unittest.skipUnless(HAS_RASTER, "raster dependencies are not installed")
class GridTest(unittest.TestCase):
    def test_tile_of_a_point(self):
        x, y = tiling.lonlat_to_tile(-79.9, -2.19, 12)
        self.assertEqual((math.floor(x), math.floor(y)), (1138, 2072))

    def test_range_and_bounds_agree(self):
        x0, y0, x1, y1 = tiling.tile_range(GUAYAQUIL, 14)
        west, _, _, north = tiling.lonlat_bounds(14, x0, y0)
        _, south, east, _ = tiling.lonlat_bounds(14, x1, y1)
        self.assertLessEqual(west, GUAYAQUIL[0])
        self.assertGreaterEqual(east, GUAYAQUIL[2])
        self.assertLessEqual(south, GUAYAQUIL[1])
        self.assertGreaterEqual(north, GUAYAQUIL[3])
        self.assertEqual(tiling.tile_count(GUAYAQUIL, 14), (x1 - x0 + 1) * (y1 - y0 + 1))

    def test_children_are_in_mosaic_order(self):
        self.assertEqual(tiling.children(3, 1, 2), [(4, 2, 4), (4, 3, 4), (4, 2, 5), (4, 3, 5)])
        parts = [np.full((2, 2), value, dtype=np.uint8) for value in (1, 2, 3, 4)]
        joined = tiling.mosaic(parts, 0, (2, 2), np.uint8)
        self.assertEqual(joined[:, :, None].squeeze().tolist(),
                         [[1, 1, 2, 2], [1, 1, 2, 2], [3, 3, 4, 4], [3, 3, 4, 4]])

    def test_weighted_block_mean_ignores_empty_cells(self):
        values = np.array([[10.0, 30.0], [0.0, 0.0]])
        weights = np.array([[1, 1], [0, 0]])
        mean, weight = tiling.block_mean(values, weights)
        self.assertEqual(mean.tolist(), [[20.0]])
        self.assertEqual(weight.tolist(), [[2.0]])


@unittest.skipUnless(HAS_RASTER, "raster dependencies are not installed")
class ArchiveTest(unittest.TestCase):
    class Flat(tiling.RasterLayer if HAS_RASTER else object):
        """Solid tiles over the west half of the bbox only."""

        tile_type = tiling.TileType.PNG if HAS_RASTER else None
        metadata = {"attribution": "test"}

        def covers(self, bounds):
            return bounds[0] < -79.9

        def leaf(self, zoom, x, y):
            return np.full((tiling.TILE_SIZE, tiling.TILE_SIZE, 3), 200, dtype=np.uint8)

        def reduce(self, parts):
            present = [part for part in parts if part is not None]
            return present[0] if present else None

        def encode(self, tile, zoom):
            buffer = io.BytesIO()
            Image.fromarray(tile[:1, :1]).save(buffer, "PNG")
            return buffer.getvalue()

    def test_writes_every_zoom_and_deduplicates(self):
        for workers in (1, 2):
            with self.subTest(workers=workers), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "flat.pmtiles"
                summary = tiling.build_archive(self.Flat(), GUAYAQUIL, 0, 13, output, "flat", workers)
                self.assertTrue(output.exists())
                self.assertEqual(sorted(p.name for p in Path(directory).iterdir()), ["flat.pmtiles"])
                self.assertEqual(summary["unique"], 1)
                with output.open("rb") as handle:
                    reader = Reader(MmapSource(handle))
                    zooms = sorted({z for (z, _, _), _ in all_tiles(reader.get_bytes)})
                    self.assertEqual(zooms, list(range(0, 14)))
                    self.assertEqual(reader.metadata()["attribution"], "test")
                self.assertEqual(tiling.read_header(output)["maxZoom"], 13)
                # Only tiles west of -79.9 are written at the highest zoom.
                with output.open("rb") as handle:
                    reader = Reader(MmapSource(handle))
                    for (z, x, _), _ in all_tiles(reader.get_bytes):
                        if z == 13:
                            self.assertLess(tiling.lonlat_bounds(13, x, 0)[0], -79.9)

    def test_fails_when_nothing_is_covered(self):
        class Nothing(self.Flat):
            def covers(self, bounds):
                return False

        with tempfile.TemporaryDirectory() as directory, self.assertRaises(RuntimeError):
            tiling.build_archive(Nothing(), GUAYAQUIL, 0, 10, Path(directory) / "none.pmtiles", "none", 1)


@unittest.skipUnless(HAS_RASTER, "raster dependencies are not installed")
class TerrainTest(unittest.TestCase):
    def test_tile_names(self):
        name = terrain.dem_tile_name(-3, -80)
        self.assertEqual(name, "Copernicus_DSM_COG_10_S03_00_W080_00_DEM")
        self.assertEqual(terrain.dem_tile_bounds(name), (-80, -3, -79, -2))
        self.assertEqual(terrain.dem_tile_bounds(terrain.dem_tile_name(0, 5)), (5, 0, 6, 1))
        available = [terrain.dem_tile_name(-3, -80), terrain.dem_tile_name(-1, -79)]
        self.assertEqual(terrain.dem_tiles_for((-80.1, -2.4, -79.5, -2.0), available), [available[0]])

    def test_terrarium_round_trip(self):
        heights = np.array([[-12.3, 0.0, 2850.77], [6263.1, np.nan, 4.2]])
        for zoom in (6, 11, 14):
            step = terrain.quantum(zoom)
            decoded = terrain.terrarium_decode(terrain.terrarium_encode(heights, step))
            expected = np.nan_to_num(heights)
            self.assertLessEqual(np.abs(decoded - expected).max(), step / 2 + 1 / 256)

    def test_quantum_grows_with_pixel_size(self):
        self.assertEqual(terrain.quantum(11), 0.125)
        self.assertEqual(terrain.quantum(12), 0.0625)
        self.assertGreater(terrain.quantum(5), terrain.quantum(9))

    def test_leaf_resamples_the_dem_and_reduce_averages(self):
        with tempfile.TemporaryDirectory() as directory:
            # A 1 x 1 degree DEM rising 1 m per column.
            size = 360
            data = np.tile(np.arange(size, dtype=np.float32), (size, 1))[None]
            name = terrain.dem_tile_name(-3, -80)
            path = geotiff(Path(directory) / f"{name}.tif", data, -80.0, -2.0, 1 / size)
            layer = terrain.TerrainLayer({name: path}, {})
            x, y = (math.floor(v) for v in tiling.lonlat_to_tile(-79.5, -2.5, 10))
            tile = layer.leaf(10, x, y)
            self.assertEqual(tile.shape, (512, 512))
            self.assertTrue(np.isfinite(tile).all())
            self.assertLess(tile[:, 0].mean(), tile[:, -1].mean())
            parent = layer.reduce([tile, None, None, None])
            self.assertTrue(np.isnan(parent[300:, 300:]).all())
            self.assertAlmostEqual(float(parent[:256, :256].mean()), float(tile.mean()), places=3)
            self.assertIsNone(layer.leaf(10, 0, 0))
            encoded = layer.encode(tile, 10)
            self.assertEqual(encoded[:4], b"RIFF")


@unittest.skipUnless(HAS_RASTER, "raster dependencies are not installed")
class ImageryTest(unittest.TestCase):
    def test_cell_names_and_urls(self):
        self.assertEqual(imagery.cell_name(-3, -80), "S03W080")
        self.assertEqual(imagery.cell_name(0, 9), "N00E009")
        self.assertEqual(
            imagery.cell_url("https://host", 2021, "v200", -1, -79),
            "https://host/rgbnir/2021/S01/ESA_WorldCover_10m_2021_v200_S01W079_S2RGBNIR.tif")
        self.assertEqual(imagery.cells_for((-78.62, -0.42, -78.3, 0.05)), [(-1, -79), (0, -79)])

    def test_overview_factor(self):
        self.assertEqual([imagery.overview_factor(z) for z in (14, 13, 12, 11, 10, 8)], [1, 1, 2, 4, 8, 16])

    def test_small_holes_are_filled_but_not_the_sea(self):
        valid = np.ones((200, 200), dtype=bool)
        valid[50:54, 50:54] = False       # a cloud
        valid[:, 150:] = False            # the open sea
        holes = imagery.small_holes(valid, 5)
        self.assertTrue(holes[50:54, 50:54].all())
        self.assertFalse(holes[:, 160:].any())

    def test_fetch_prepare_and_render(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            size = 1200
            pixel = 0.1 / size
            primary = np.full((3, size, size), 800, dtype=np.uint16)
            primary[:, 100:110, 100:110] = 0      # small gap: filled from the older composite
            primary[:, 500:520, 500:520] = 0      # missing in both: painted from around
            primary[:, :, 1100:] = 0              # sea in both
            older = np.full((3, size, size), 1600, dtype=np.uint16)
            older[:, 500:520, 500:520] = 0
            older[:, :, 1100:] = 0
            first = geotiff(folder / "2021.tif", primary, -79.95, -2.15, pixel, nodata=0)
            second = geotiff(folder / "2020.tif", older, -79.95, -2.15, pixel, nodata=0)
            raw = folder / "cell.raw.tif"
            details = imagery.fetch_cell([str(first), str(second)], GUAYAQUIL, 1, raw)
            self.assertEqual(details["pixelsFromFallback"], 100)
            prepared = folder / "cell.rgba.tif"
            imagery.prepare_cell(raw, prepared, fill_metres=300)
            with rasterio.open(prepared) as dataset:
                rgba = dataset.read()
            self.assertEqual(rgba.shape, (4, size, size))
            self.assertTrue((rgba[3, 505, 505] == 255))                    # painted
            self.assertTrue((rgba[3, :, 1150:] == 0).all())                # sea stays transparent
            self.assertGreater(int(rgba[0, 105, 105]), int(rgba[0, 700, 700]))  # older, brighter fill
            layer = imagery.ImageryLayer({"cell": (prepared, GUAYAQUIL)}, {"attribution": "test"})
            x, y = (math.floor(v) for v in tiling.lonlat_to_tile(-79.9, -2.2, 13))
            tile = layer.leaf(13, x, y)
            self.assertEqual(tile.shape, (512, 512, 4))
            self.assertEqual(int(tile[256, 256, 3]), 255)
            parent = layer.reduce([tile, None, None, None])
            self.assertEqual(int(parent[400, 400, 3]), 0)
            self.assertEqual(layer.encode(tile, 13)[:4], b"RIFF")


if __name__ == "__main__":
    unittest.main()
