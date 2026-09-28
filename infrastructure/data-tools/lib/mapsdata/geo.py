"""Geometry helpers of the data pipeline.

Pure Python on purpose: the data-tools image only needs the standard library.

* GeoPackage geometry blobs (header + ISO/extended WKB) decoding.
* UTM (SIRGAS 95 / WGS 84 ellipsoid) to longitude/latitude with the Krueger series used by
  PROJ (accurate to nanometres inside the zone and to millimetres 10 degrees away from it,
  which covers the Galapagos stored in zone 17 by the national census cartography).
* Distances, bounding boxes and representative points in longitude/latitude.
"""

from __future__ import annotations

import cmath
import math
import struct
from typing import Iterable, Sequence

Point = tuple[float, float]
Ring = list[Point]

# GRS 80 (SIRGAS); WGS 84 only differs by 0.1 mm in the semi-minor axis.
_A = 6_378_137.0
_F = 1 / 298.257222101
_E2 = _F * (2 - _F)
_E = math.sqrt(_E2)
_N = _F / (2 - _F)
_K0 = 0.9996
_RECTIFYING = _A / (1 + _N) * (1 + _N**2 / 4 + _N**4 / 64 + _N**6 / 256)
_BETA = (
    _N / 2 - 2 * _N**2 / 3 + 37 * _N**3 / 96 - _N**4 / 360 - 81 * _N**5 / 512 + 96199 * _N**6 / 604800,
    _N**2 / 48 + _N**3 / 15 - 437 * _N**4 / 1440 + 46 * _N**5 / 105 - 1118711 * _N**6 / 3870720,
    17 * _N**3 / 480 - 37 * _N**4 / 840 - 209 * _N**5 / 4480 + 5569 * _N**6 / 90720,
    4397 * _N**4 / 161280 - 11 * _N**5 / 504 - 830251 * _N**6 / 7257600,
    4583 * _N**5 / 161280 - 108847 * _N**6 / 3991680,
    20648693 * _N**6 / 638668800,
)

EARTH_RADIUS_M = 6_371_008.8
METERS_PER_DEGREE = math.pi * EARTH_RADIUS_M / 180

#: EPSG codes of the UTM zones the pipeline understands: (zone, southern hemisphere).
UTM_ZONES = {
    31992: (17, True),  # SIRGAS 1995 / UTM zone 17S (INEC national cartography)
    31993: (18, True),
    31976: (17, False),  # SIRGAS 1995 / UTM zone 17N
    32717: (17, True),  # WGS 84 / UTM zone 17S
    32617: (17, False),
    32715: (15, True),
    32716: (16, True),
}


def utm_to_lonlat(easting: float, northing: float, zone: int = 17, south: bool = True) -> Point:
    """Inverse transverse Mercator (Karney 2011, 6th order); returns (longitude, latitude)."""
    xi = (northing - (10_000_000.0 if south else 0.0)) / (_K0 * _RECTIFYING)
    eta = (easting - 500_000.0) / (_K0 * _RECTIFYING)
    zeta = complex(xi, eta)
    prime = zeta
    for order, beta in enumerate(_BETA, start=1):
        prime -= beta * cmath.sin(2 * order * zeta)
    xi_p, eta_p = prime.real, prime.imag
    tau_p = math.sin(xi_p) / math.sqrt(math.sinh(eta_p) ** 2 + math.cos(xi_p) ** 2)
    longitude = math.radians(zone * 6 - 183) + math.atan2(math.sinh(eta_p), math.cos(xi_p))
    tau = tau_p
    for _ in range(6):
        sigma = math.sinh(_E * math.atanh(_E * tau / math.sqrt(1 + tau * tau)))
        tau_i = tau * math.sqrt(1 + sigma * sigma) - sigma * math.sqrt(1 + tau * tau)
        step = (tau_p - tau_i) / math.sqrt(1 + tau_i * tau_i) * (1 + (1 - _E2) * tau * tau) / (
            (1 - _E2) * math.sqrt(1 + tau * tau)
        )
        tau += step
        if abs(step) < 1e-13:
            break
    return math.degrees(longitude), math.degrees(math.atan(tau))


def projector(srs_id: int):
    """Returns a function (x, y) -> (lon, lat) for the given EPSG code."""
    if srs_id in (4326, 4674, 4190):  # geographic WGS 84 / SIRGAS 2000 / POSGAR
        return lambda x, y: (x, y)
    if srs_id not in UTM_ZONES:
        raise ValueError(f"unsupported spatial reference EPSG:{srs_id}")
    zone, south = UTM_ZONES[srs_id]
    return lambda x, y: utm_to_lonlat(x, y, zone, south)


# ---------------------------------------------------------------- GeoPackage / WKB

_ENVELOPE_BYTES = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
_MULTI = {4: "MultiPoint", 5: "MultiLineString", 6: "MultiPolygon", 7: "GeometryCollection"}


def parse_gpkg_geometry(blob: bytes | None):
    """Decodes a GeoPackage geometry blob into ("Type", coordinates) or None when empty.

    Coordinates keep the stored projection; LineString -> [(x, y)...], Polygon -> [ring...],
    Multi* -> [part coordinates...].
    """
    if not blob or blob[:2] != b"GP":
        return None
    flags = blob[3]
    if flags & 0b10000:
        return None
    envelope = (flags >> 1) & 0b111
    if envelope not in _ENVELOPE_BYTES:
        raise ValueError(f"invalid GeoPackage envelope indicator {envelope}")
    geometry, _ = _parse_wkb(blob, 8 + _ENVELOPE_BYTES[envelope])
    return geometry


def _parse_wkb(blob: bytes, offset: int):
    order = "<" if blob[offset] == 1 else ">"
    (kind,) = struct.unpack_from(order + "I", blob, offset + 1)
    offset += 5
    dims = 2
    base = kind
    if kind & 0xE0000000:  # EWKB flags (Z 0x80000000, M 0x40000000, SRID 0x20000000)
        dims += (1 if kind & 0x80000000 else 0) + (1 if kind & 0x40000000 else 0)
        if kind & 0x20000000:
            offset += 4
        base = kind & 0x0FFFFFFF
    elif kind >= 1000:
        dims += {1: 1, 2: 1, 3: 2}[kind // 1000]
        base = kind % 1000
    if base == 1:
        values = struct.unpack_from(f"{order}{dims}d", blob, offset)
        return ("Point", (values[0], values[1])), offset + 8 * dims
    if base == 2:
        points, offset = _points(blob, offset, order, dims)
        return ("LineString", points), offset
    if base == 3:
        (count,) = struct.unpack_from(order + "I", blob, offset)
        offset += 4
        rings = []
        for _ in range(count):
            ring, offset = _points(blob, offset, order, dims)
            rings.append(ring)
        return ("Polygon", rings), offset
    if base in _MULTI:
        (count,) = struct.unpack_from(order + "I", blob, offset)
        offset += 4
        parts = []
        for _ in range(count):
            (_, coordinates), offset = _parse_wkb(blob, offset)
            parts.append(coordinates)
        return (_MULTI[base], parts), offset
    raise ValueError(f"unsupported WKB geometry type {kind}")


def _points(blob: bytes, offset: int, order: str, dims: int):
    (count,) = struct.unpack_from(order + "I", blob, offset)
    offset += 4
    values = struct.unpack_from(f"{order}{count * dims}d", blob, offset)
    return [(values[i], values[i + 1]) for i in range(0, len(values), dims)], offset + 8 * dims * count


# ---------------------------------------------------------------- measures


def haversine(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Great-circle distance in metres."""
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def line_length(points: Sequence[Point]) -> float:
    return sum(haversine(*points[i - 1], *points[i]) for i in range(1, len(points)))


def bbox(points: Iterable[Point]) -> list[float]:
    min_x = min_y = math.inf
    max_x = max_y = -math.inf
    for x, y in points:
        min_x = min(min_x, x)
        min_y = min(min_y, y)
        max_x = max(max_x, x)
        max_y = max(max_y, y)
    return [min_x, min_y, max_x, max_y]


def ring_area_centroid(ring: Sequence[Point]) -> tuple[float, float, float]:
    """Signed planar area and centroid of a ring (degrees; fine for label placement)."""
    area = cx = cy = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        cross = x1 * y2 - x2 * y1
        area += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    area /= 2
    if abs(area) < 1e-18:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return 0.0, sum(xs) / len(xs), sum(ys) / len(ys)
    return area, cx / (6 * area), cy / (6 * area)


def point_in_ring(x: float, y: float, ring: Sequence[Point]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def point_in_polygon(x: float, y: float, polygon: Sequence[Ring]) -> bool:
    return bool(polygon) and point_in_ring(x, y, polygon[0]) and not any(
        point_in_ring(x, y, hole) for hole in polygon[1:]
    )


def representative_point(polygons: Sequence[Sequence[Ring]]) -> Point:
    """A point inside the biggest polygon: its centroid when inside, otherwise the middle of
    the widest horizontal chord through the centroid latitude (always inside)."""
    biggest = max(polygons, key=lambda polygon: abs(ring_area_centroid(polygon[0])[0]))
    _, cx, cy = ring_area_centroid(biggest[0])
    if point_in_polygon(cx, cy, biggest):
        return cx, cy
    ys = sorted({p[1] for p in biggest[0]})
    candidates = [cy] + [(ys[i] + ys[i + 1]) / 2 for i in range(len(ys) - 1)]
    candidates.sort(key=lambda value: abs(value - cy))
    for y in candidates[:50]:
        crossings = []
        for ring in biggest:
            for i in range(len(ring) - 1):
                (x1, y1), (x2, y2) = ring[i], ring[i + 1]
                if (y1 > y) != (y2 > y):
                    crossings.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        crossings.sort()
        best = None
        for i in range(0, len(crossings) - 1, 2):
            width = crossings[i + 1] - crossings[i]
            if best is None or width > best[0]:
                best = (width, (crossings[i] + crossings[i + 1]) / 2)
        if best:
            return best[1], y
    return biggest[0][0]


def round_point(point: Point, digits: int = 6) -> list[float]:
    return [round(point[0], digits), round(point[1], digits)]


class PolygonIndex:
    """Point-in-polygon lookups over many polygons (grid of their bounding boxes)."""

    def __init__(self, cell: float = 0.05) -> None:
        self.cell = cell
        self.shapes: list[tuple[list[list[Ring]], list[float]]] = []
        self.grid: dict[tuple[int, int], list[int]] = {}

    def add(self, polygons: list[list[Ring]]) -> None:
        if not polygons:
            return
        box = bbox(p for polygon in polygons for ring in polygon for p in ring)
        index = len(self.shapes)
        self.shapes.append((polygons, box))
        for cx in range(int(box[0] // self.cell), int(box[2] // self.cell) + 1):
            for cy in range(int(box[1] // self.cell), int(box[3] // self.cell) + 1):
                self.grid.setdefault((cx, cy), []).append(index)

    def contains(self, lon: float, lat: float) -> bool:
        for index in self.grid.get((int(lon // self.cell), int(lat // self.cell)), ()):
            polygons, box = self.shapes[index]
            if box[0] <= lon <= box[2] and box[1] <= lat <= box[3]:
                if any(point_in_polygon(lon, lat, polygon) for polygon in polygons):
                    return True
        return False
