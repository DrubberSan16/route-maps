"""Routable road network of a region, built from the official street and road layers.

Inputs: census street axes (every urban street of the country, with names) and the state road
network (highways between towns, with route numbers). Outputs:

* `graph.bin` + `graph.json`: the compact graph the backend routes on (see `write_graph`).
* `map-roads.geojson`: the same roads with classes, labels and route numbers for the tiles.

Topology repairs (sized on the national data):
* lines are split where a vertex is shared with another line (T and X junctions);
* a dead end lying within `SNAP_METERS` of another street is joined to it (digitising gaps);
* state-road stretches that duplicate a census street are dropped from the graph and their
  route number/class is transferred to that street; the stretches kept (between towns) are
  joined to the streets where they end;
* a state road that stops short of the town it enters (the national layer leaves out many urban
  stretches) is joined to the nearest road the network does not already reach, with a flagged
  straight link (see `link_loose_ends`).
"""

from __future__ import annotations

import heapq
import json
import math
import struct
import sys
from array import array
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable, Iterable

from . import geo
from .text import Speller, clean, normalize_kind, street_label, title

# Road classes shared with the backend (value = index).
CLASSES = ("motorway", "trunk", "primary", "secondary", "tertiary", "street", "service", "track",
           "path", "footway", "steps", "connector")
MOTORWAY, TRUNK, PRIMARY, SECONDARY, TERTIARY, STREET, SERVICE, TRACK, PATH, FOOTWAY, STEPS, CONNECTOR = range(12)
MOTOR_CLASSES = {MOTORWAY, TRUNK, PRIMARY, SECONDARY, TERTIARY, STREET, SERVICE, TRACK}
KIND_CLASS = {
    "AUTOPISTA": MOTORWAY, "PANAMERICANA": TRUNK, "CARRETERA": PRIMARY, "CIRCUNVALACION": PRIMARY,
    "VIA": PRIMARY, "AVENIDA": SECONDARY, "TRANSVERSAL": TERTIARY, "DIAGONAL": TERTIARY, "CALLE": STREET,
    "REDONDEL": STREET, "RETORNO": STREET, "HERRADURA": STREET, "TUNEL": STREET, "PASAJE": SERVICE,
    "CALLEJON": SERVICE, "CAMINO": TRACK, "SENDERO": PATH, "PASEO": PATH, "PEATONAL": FOOTWAY,
    "ESCALINATA": STEPS,
}
FLAG_ROUNDABOUT = 1
FLAG_STATE_ROAD = 2
FLAG_UNPAVED = 4
FLAG_TUNNEL = 8
#: Straight link across a gap of the official data (a town whose access road is not mapped).
FLAG_APPROXIMATE = 16

SOURCE_STREET, SOURCE_STATE_ROAD, SOURCE_CONNECTOR = 0, 1, 2

SNAP_METERS = 3.0  # dead end of a street -> another street
STATE_SNAP_METERS = 60.0  # dead end of a state road -> a street or another state road
STATE_GAP_METERS = 300.0  # dead end of a state road -> another state road (gaps of the national layer)
SIDE_ROAD_METERS = 12.0  # dead end of a street -> a state road
LADDER_METERS = 15.0  # any street end -> a state road running along it
CONNECT_METERS = 150.0  # dead end of a state road -> nearest street junction
APPROXIMATE_MAX_METERS = 6000.0  # longest straight link that joins an isolated town
APPROXIMATE_MIN_NODES = 25  # smaller fragments (a lane, a private estate) stay apart
LOOSE_END_METERS = 1000.0  # loose end of a state road -> nearest road the network does not join
DETOUR_FACTOR = 3.0  # two nodes are already joined when the network links them within
DETOUR_SLACK_METERS = 1000.0  # DETOUR_FACTOR x their distance + DETOUR_SLACK_METERS
LAND_STEP_METERS = 200.0
CONFLATE_METERS = 22.0
CONFLATE_DEGREES = 35.0
SAMPLE_METERS = 15.0
CELL_METERS = 30.0
M_PER_DEG = geo.METERS_PER_DEGREE
COS0 = math.cos(math.radians(1.5))


def log(message: str) -> None:
    print(f"[network] {message}", file=sys.stderr, flush=True)


def _mx(lon: float) -> float:
    return lon * M_PER_DEG * COS0


def _my(lat: float) -> float:
    return lat * M_PER_DEG


def _key(lon: float, lat: float) -> int:
    return (round(lon * 1e6) + 180_000_000) * 400_000_000 + round(lat * 1e6) + 90_000_000


class Lines:
    """Polylines in flat arrays (about three million vertices nationwide)."""

    def __init__(self) -> None:
        self.lon = array("d")
        self.lat = array("d")
        self.start = array("q", [0])
        self.cls = array("B")
        self.flags = array("B")
        self.name = array("q")
        self.ref = array("q")
        self.parish = array("q")
        self.source = array("B")

    def __len__(self) -> int:
        return len(self.cls)

    def add(self, points, cls: int, name: int, ref: int, parish: int, source: int, flags: int = 0) -> int:
        for lon, lat in points:
            self.lon.append(lon)
            self.lat.append(lat)
        self.start.append(len(self.lon))
        self.cls.append(cls)
        self.flags.append(flags)
        self.name.append(name)
        self.ref.append(ref)
        self.parish.append(parish)
        self.source.append(source)
        return len(self.cls) - 1

    def copy_line(self, other: "Lines", line: int, points=None, **overrides) -> int:
        pts = points if points is not None else other.points(line)
        return self.add(pts, overrides.get("cls", other.cls[line]), other.name[line], other.ref[line],
                        other.parish[line], other.source[line], other.flags[line])

    def points(self, line: int) -> list[tuple[float, float]]:
        return [(self.lon[i], self.lat[i]) for i in range(self.start[line], self.start[line + 1])]

    def ends(self, line: int) -> tuple[int, int]:
        return self.start[line], self.start[line + 1] - 1


class Strings:
    def __init__(self) -> None:
        self.values: list[str] = []
        self.index: dict[str, int] = {}

    def id(self, value: str | None) -> int:
        if not value:
            return -1
        found = self.index.get(value)
        if found is None:
            found = self.index[value] = len(self.values)
            self.values.append(value)
        return found


def _projection(px, py, ax, ay, bx, by) -> tuple[float, float]:
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    t = 0.0 if length2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t


def _cells_around(lon: float, lat: float, radius: float) -> Iterable[tuple[int, int]]:
    cx, cy = int(_mx(lon) // CELL_METERS), int(_my(lat) // CELL_METERS)
    span = int(radius // CELL_METERS) + 1
    for ax in range(cx - span, cx + span + 1):
        for ay in range(cy - span, cy + span + 1):
            yield ax, ay


class SegmentGrid:
    """Segments of accepted lines indexed by cell; only `wanted` cells are stored."""

    def __init__(self, lines: Lines, wanted: set[tuple[int, int]], accept: Callable[[int], bool]) -> None:
        self.lines = lines
        self.cells: dict[tuple[int, int], list[int]] = defaultdict(list)
        self.owner: dict[int, int] = {}
        lon, lat = lines.lon, lines.lat
        for line in range(len(lines)):
            if not accept(line):
                continue
            for i in range(lines.start[line], lines.start[line + 1] - 1):
                x1, y1, x2, y2 = _mx(lon[i]), _my(lat[i]), _mx(lon[i + 1]), _my(lat[i + 1])
                stored = False
                for cx in range(int(min(x1, x2) // CELL_METERS), int(max(x1, x2) // CELL_METERS) + 1):
                    for cy in range(int(min(y1, y2) // CELL_METERS), int(max(y1, y2) // CELL_METERS) + 1):
                        if (cx, cy) in wanted:
                            self.cells[(cx, cy)].append(i)
                            stored = True
                if stored:
                    self.owner[i] = line

    def nearest(self, lon: float, lat: float, radius: float, accept: Callable[[int], bool] | None = None):
        """(distance m, segment start vertex, t) of the nearest accepted segment within radius."""
        px, py = _mx(lon), _my(lat)
        lines = self.lines
        best = None
        for cell in _cells_around(lon, lat, radius):
            for i in self.cells.get(cell, ()):
                if accept is not None and not accept(self.owner[i]):
                    continue
                d, t = _projection(px, py, _mx(lines.lon[i]), _my(lines.lat[i]), _mx(lines.lon[i + 1]),
                                   _my(lines.lat[i + 1]))
                if d <= radius and (best is None or d < best[0]):
                    best = (d, i, t)
        return best


def _bearing(lon1, lat1, lon2, lat2) -> float:
    return math.degrees(math.atan2(_mx(lon2) - _mx(lon1), _my(lat2) - _my(lat1)))


def _undirected_difference(a: float, b: float) -> float:
    difference = abs(a - b) % 180
    return min(difference, 180 - difference)


# ---------------------------------------------------------------- loading


def load_streets(features: Iterable[dict[str, Any]], lines: Lines, names: Strings, parishes: Strings,
                 speller: Speller, kinds: dict[int, str]) -> dict[str, int]:
    stats: dict[str, int] = defaultdict(int)
    for feature in features:
        props = feature.get("properties") or {}
        kind = normalize_kind(props.get("k"))
        coordinates = (feature.get("geometry") or {}).get("coordinates") or []
        if kind == "LINEA FERREA" or len(coordinates) < 2:
            stats["rail_or_empty"] += 1
            continue
        label = street_label(kind, clean(props.get("n")), speller)
        cls = KIND_CLASS.get(kind or "", STREET)
        flags = FLAG_ROUNDABOUT if kind == "REDONDEL" else FLAG_TUNNEL if kind == "TUNEL" else 0
        line = lines.add(coordinates, cls, names.id(label), -1, parishes.id(clean(props.get("p"))),
                         SOURCE_STREET, flags)
        if kind:
            kinds[line] = kind
        stats["streets"] += 1
    return stats


def load_state_roads(path: Path, lines: Lines, names: Strings, speller: Speller) -> int:
    if not path.exists():
        return 0
    data = json.loads(path.read_text(encoding="utf-8"))
    count = 0
    for feature in data.get("features") or []:
        props = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        parts = [coordinates] if geometry.get("type") == "LineString" else coordinates
        hierarchy = (clean(props.get("clasificac")) or "").upper()
        lanes = _number(props.get("numero_car"))
        cls = TRUNK if hierarchy == "ARTERIAL" else PRIMARY
        if cls == TRUNK and lanes >= 6:
            cls = MOTORWAY
        surface = (clean(props.get("tipo_calza")) or "").upper()
        flags = FLAG_STATE_ROAD | (FLAG_UNPAVED if surface in {"LASTRE", "MEJORAMIENTO DE SUELO"} else 0)
        ref = _route_number(props.get("codigo_via"))
        corridor_raw = clean(props.get("troncales"))
        corridor = title(corridor_raw, speller) if corridor_raw and corridor_raw.upper() != "RVE" else None
        for part in parts:
            points = [(round(p[0], 6), round(p[1], 6)) for p in part or [] if isinstance(p, list) and len(p) >= 2]
            points = [p for i, p in enumerate(points) if i == 0 or p != points[i - 1]]
            if len(points) >= 2:
                lines.add(points, cls, names.id(corridor), names.id(ref), -1, SOURCE_STATE_ROAD, flags)
                count += 1
    return count


def _number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _route_number(value: Any) -> str | None:
    text = clean(value)
    return text.replace(" ", "").split("/")[0].upper() if text else None


# ---------------------------------------------------------------- conflation of state roads


def _sample(points: list[tuple[float, float]]) -> list[tuple[float, float, int, float, float]]:
    """(lon, lat, segment, fraction, bearing) every SAMPLE_METERS along a line."""
    out = []
    for i in range(len(points) - 1):
        (x1, y1), (x2, y2) = points[i], points[i + 1]
        steps = max(1, int(geo.haversine(x1, y1, x2, y2) // SAMPLE_METERS))
        bearing = _bearing(x1, y1, x2, y2)
        for s in range(steps):
            f = s / steps
            out.append((x1 + (x2 - x1) * f, y1 + (y2 - y1) * f, i, f, bearing))
    return out


def _between(points, start: tuple[int, float, float, float], end: tuple[int, float, float, float]):
    """Polyline from position start to position end: (segment, fraction, lon, lat)."""
    segment_a, _, lon_a, lat_a = start
    segment_b, _, lon_b, lat_b = end
    out = [(round(lon_a, 6), round(lat_a, 6))]
    # Vertex v starts segment v: it lies after A (inside segment_a) and not after B.
    for vertex in range(segment_a + 1, segment_b + 1):
        out.append(points[vertex])
    out.append((round(lon_b, 6), round(lat_b, 6)))
    return [p for i, p in enumerate(out) if i == 0 or p != out[i - 1]]


def _smooth(flags: list[bool], gap: int) -> list[bool]:
    out = list(flags)
    n = len(flags)
    i = 0
    while i < n:  # short uncovered gaps inside a covered run are junctions or bends
        if flags[i]:
            i += 1
            continue
        j = i
        while j < n and not flags[j]:
            j += 1
        if 0 < i and j < n and j - i <= gap:
            for k in range(i, j):
                out[k] = True
        i = j
    for i in range(n):  # a lone covered sample is a crossing street, not a duplicate
        if out[i] and (i == 0 or not out[i - 1]) and (i == n - 1 or not out[i + 1]):
            out[i] = False
    return out


def conflate(lines: Lines, street_count: int, stats: dict[str, int]) -> tuple[Lines, Lines]:
    """Returns (routing lines, state-road stretches to draw at high zoom).

    The routing lines keep every state road whole: the national backbone must never be cut where
    the census streets of a town duplicate it. Streets that duplicate a state road take its route
    number and class. The map stretches are the parts of the state roads no street duplicates.
    """
    samples = {line: _sample(lines.points(line)) for line in range(street_count, len(lines))}
    wanted: set[tuple[int, int]] = set()
    for points in samples.values():
        for lon, lat, *_ in points:
            wanted.update(_cells_around(lon, lat, CONFLATE_METERS))
    grid = SegmentGrid(lines, wanted, lambda line: line < street_count and lines.cls[line] in MOTOR_CLASSES)
    covered_length: dict[int, float] = defaultdict(float)
    promotion: dict[int, int] = {}
    result = Lines()
    for line in range(len(lines)):
        result.copy_line(lines, line)
    map_parts = Lines()
    for line, points in samples.items():
        hits = []
        for lon, lat, _, _, bearing in points:
            found = grid.nearest(lon, lat, CONFLATE_METERS)
            ok = False
            if found:
                i = found[1]
                other = _bearing(lines.lon[i], lines.lat[i], lines.lon[i + 1], lines.lat[i + 1])
                if _undirected_difference(bearing, other) <= CONFLATE_DEGREES:
                    street = grid.owner[i]
                    covered_length[street] += SAMPLE_METERS
                    promotion[street] = line
                    ok = True
            hits.append(ok)
        hits = _smooth(hits, 4)
        pts = lines.points(line)
        end_position = (len(pts) - 2, 1.0, pts[-1][0], pts[-1][1])
        k = 0
        while k < len(points):
            if hits[k]:
                stats["state_samples_duplicated"] += 1
                k += 1
                continue
            j = k
            while j < len(points) and not hits[j]:
                j += 1
            start = (points[k][2], points[k][3], points[k][0], points[k][1])
            end = end_position if j == len(points) else (points[j][2], points[j][3], points[j][0], points[j][1])
            part = _between(pts, start, end)
            if len(part) >= 2 and geo.line_length(part) >= 1:
                map_parts.copy_line(lines, line, points=part)
                stats["state_parts_kept"] += 1
            stats["state_samples_kept"] += j - k
            k = j
    for street, meters in covered_length.items():
        total = geo.line_length(lines.points(street))
        if total > 0 and meters >= 0.5 * total:
            road = promotion[street]
            if lines.cls[road] < result.cls[street]:
                result.cls[street] = lines.cls[road]
            if result.ref[street] < 0:
                result.ref[street] = lines.ref[road]
            result.flags[street] |= lines.flags[road] & FLAG_UNPAVED
            stats["streets_promoted"] += 1
    return result, map_parts


# ---------------------------------------------------------------- noding


def build_graph(lines: Lines, stats: dict[str, int]) -> dict[str, Any]:
    """Splits lines into edges between junctions; joins dead ends; returns the graph arrays."""
    endpoint_count: dict[int, int] = defaultdict(int)
    for line in range(len(lines)):
        for i in lines.ends(line):
            endpoint_count[_key(lines.lon[i], lines.lat[i])] += 1
    split_keys: set[int] = set()
    interior_seen: dict[int, int] = {}
    for line in range(len(lines)):
        s, e = lines.ends(line)
        for i in range(s + 1, e):
            key = _key(lines.lon[i], lines.lat[i])
            if key in endpoint_count:
                split_keys.add(key)
                continue
            first = interior_seen.setdefault(key, line)
            if first != line:
                split_keys.add(key)
    del interior_seen
    stats["shared_vertex_junctions"] = len(split_keys)

    dangling = []
    for line in range(len(lines)):
        for i in lines.ends(line):
            key = _key(lines.lon[i], lines.lat[i])
            if endpoint_count[key] == 1 and key not in split_keys:
                dangling.append((i, line))
    stats["dead_ends"] = len(dangling)
    wanted: set[tuple[int, int]] = set()
    for i, line in dangling:
        radius = STATE_GAP_METERS if lines.source[line] == SOURCE_STATE_ROAD else SIDE_ROAD_METERS
        wanted.update(_cells_around(lines.lon[i], lines.lat[i], radius))
    grid = SegmentGrid(lines, wanted, lambda line: lines.source[line] != SOURCE_CONNECTOR)
    # Junction nodes of streets, for state-road ends that do not touch any street segment.
    junctions: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
    for line in range(len(lines)):
        if lines.source[line] == SOURCE_STREET and lines.cls[line] in MOTOR_CLASSES:
            for i in lines.ends(line):
                lon, lat = lines.lon[i], lines.lat[i]
                junctions[(int(_mx(lon) // 100), int(_my(lat) // 100))].append((lon, lat))

    insertions: dict[int, list[tuple[float, float, float]]] = defaultdict(list)
    joins: list[tuple[float, float, float, float]] = []
    loose: list[tuple[float, float, int]] = []  # state-road ends with nothing nearby
    for i, line in dangling:
        lon, lat = lines.lon[i], lines.lat[i]
        source = lines.source[line]
        found = None
        if source == SOURCE_STATE_ROAD:
            found = grid.nearest(lon, lat, STATE_SNAP_METERS,
                                 lambda other: other != line and lines.source[other] != SOURCE_CONNECTOR
                                 and lines.cls[other] in MOTOR_CLASSES)
            if not found:
                found = grid.nearest(lon, lat, STATE_GAP_METERS,
                                     lambda other: other != line and lines.source[other] == SOURCE_STATE_ROAD)
                if found:
                    stats["state_road_gaps_closed"] += 1
            if not found:
                target = _nearest_junction(junctions, lon, lat)
                if target:
                    joins.append((lon, lat, target[0], target[1]))
                    stats["state_road_ends_to_junction"] += 1
                else:
                    loose.append((lon, lat, lines.ref[line]))
                continue
            stats["state_road_ends_projected"] += 1
        else:
            found = grid.nearest(lon, lat, SNAP_METERS, lambda other: other != line)
            if not found and lines.cls[line] in MOTOR_CLASSES:
                found = grid.nearest(lon, lat, SIDE_ROAD_METERS,
                                     lambda other: lines.source[other] == SOURCE_STATE_ROAD)
                if found:
                    stats["side_roads_joined"] += 1
            if not found:
                continue
            stats["dead_ends_joined"] += 1
        _, segment, t = found
        plon = round(lines.lon[segment] + (lines.lon[segment + 1] - lines.lon[segment]) * t, 6)
        plat = round(lines.lat[segment] + (lines.lat[segment + 1] - lines.lat[segment]) * t, 6)
        insertions[segment].append((t, plon, plat))
        joins.append((lon, lat, plon, plat))
    _ladders(lines, insertions, joins, stats)
    for _, _, plon, plat in joins:
        split_keys.add(_key(plon, plat))

    node_of: dict[int, int] = {}
    node_lon, node_lat = array("d"), array("d")

    def node(lon: float, lat: float) -> int:
        key = _key(lon, lat)
        found = node_of.get(key)
        if found is None:
            found = node_of[key] = len(node_lon)
            node_lon.append(lon)
            node_lat.append(lat)
        return found

    out = {name: array(code) for name, code in (
        ("edge_u", "l"), ("edge_v", "l"), ("edge_len", "f"), ("edge_cls", "B"), ("edge_flags", "B"),
        ("edge_name", "l"), ("edge_ref", "l"), ("edge_parish", "l"), ("shape_lon", "l"), ("shape_lat", "l"))}
    out["shape_off"] = array("L", [0])

    def emit(pts: list[tuple[float, float]], cls: int, flags: int, name: int, ref: int, parish: int) -> None:
        if len(pts) < 2:
            return
        length = geo.line_length(pts)
        u, v = node(*pts[0]), node(*pts[-1])
        if u == v and length < 1:
            return
        out["edge_u"].append(u)
        out["edge_v"].append(v)
        out["edge_len"].append(max(0.1, length))
        out["edge_cls"].append(cls)
        out["edge_flags"].append(flags)
        out["edge_name"].append(name)
        out["edge_ref"].append(ref)
        out["edge_parish"].append(parish)
        for lon, lat in pts[1:-1]:
            out["shape_lon"].append(round(lon * 1e7))
            out["shape_lat"].append(round(lat * 1e7))
        out["shape_off"].append(len(out["shape_lon"]))

    for line in range(len(lines)):
        attrs = (lines.cls[line], lines.flags[line], lines.name[line], lines.ref[line], lines.parish[line])
        s, e = lines.ends(line)
        current: list[tuple[float, float]] = []
        for i in range(s, e + 1):
            point = (lines.lon[i], lines.lat[i])
            if not current or current[-1] != point:
                current.append(point)
                if s < i < e and _key(*point) in split_keys:
                    emit(current, *attrs)
                    current = [point]
            if i < e and i in insertions:
                for _, plon, plat in sorted(insertions[i]):
                    if current[-1] != (plon, plat):
                        current.append((plon, plat))
                    if len(current) >= 2:
                        emit(current, *attrs)
                    current = [(plon, plat)]
        emit(current, *attrs)
    for lon, lat, plon, plat in joins:
        if (lon, lat) != (plon, plat):
            emit([(lon, lat), (plon, plat)], CONNECTOR, 0, -1, -1, -1)
    stats["nodes"] = len(node_lon)
    stats["edges"] = len(out["edge_u"])
    stats["shape_points"] = len(out["shape_lon"])
    out["node_lon"] = node_lon
    out["node_lat"] = node_lat
    # Not written to graph.bin: consumed by link_loose_ends.
    out["loose_state_ends"] = [(node_of[_key(lon, lat)], ref) for lon, lat, ref in loose
                               if _key(lon, lat) in node_of]
    stats["loose_state_ends"] = len(out["loose_state_ends"])
    return out


def _ladders(lines: Lines, insertions, joins, stats) -> None:
    """Joins every street end lying next to a state road to it: side streets meeting the highway and
    the junctions of a census street that duplicates it through a town."""
    near_state: set[tuple[int, int]] = set()
    for line in range(len(lines)):
        if lines.source[line] != SOURCE_STATE_ROAD:
            continue
        for i in range(lines.start[line], lines.start[line + 1] - 1):
            # Cells along the segment (the grid below only keeps these).
            steps = max(1, int(geo.haversine(lines.lon[i], lines.lat[i], lines.lon[i + 1], lines.lat[i + 1])
                               // (CELL_METERS / 2)))
            for k in range(steps + 1):
                f = k / steps
                lon = lines.lon[i] + (lines.lon[i + 1] - lines.lon[i]) * f
                lat = lines.lat[i] + (lines.lat[i + 1] - lines.lat[i]) * f
                near_state.update(_cells_around(lon, lat, LADDER_METERS))
    grid = SegmentGrid(lines, near_state, lambda line: lines.source[line] == SOURCE_STATE_ROAD)
    done: set[int] = set()
    for line in range(len(lines)):
        if lines.source[line] != SOURCE_STREET or lines.cls[line] not in MOTOR_CLASSES:
            continue
        for i in lines.ends(line):
            lon, lat = lines.lon[i], lines.lat[i]
            if (int(_mx(lon) // CELL_METERS), int(_my(lat) // CELL_METERS)) not in near_state:
                continue
            key = _key(lon, lat)
            if key in done:
                continue
            done.add(key)
            found = grid.nearest(lon, lat, LADDER_METERS)
            if not found:
                continue
            _, segment, t = found
            plon = round(lines.lon[segment] + (lines.lon[segment + 1] - lines.lon[segment]) * t, 6)
            plat = round(lines.lat[segment] + (lines.lat[segment + 1] - lines.lat[segment]) * t, 6)
            if (plon, plat) == (lon, lat):
                continue
            insertions[segment].append((t, plon, plat))
            joins.append((lon, lat, plon, plat))
            stats["street_state_links"] += 1


def bridge_components(graph: dict[str, Any], is_land, stats: dict[str, int]) -> None:
    """Links isolated towns to the national network with straight, flagged edges.

    The census covers the streets of every town and the state layer the highways, but the access
    roads between some towns and their highway are in neither. A town whose streets form their own
    component gets one straight link (FLAG_APPROXIMATE) to the nearest node of the main network when
    it is closer than APPROXIMATE_MAX_METERS and the whole link runs over land. Clients show these
    stretches as approximate; nothing is drawn on the map.
    """
    node_lon, node_lat = graph["node_lon"], graph["node_lat"]
    count = len(node_lon)
    parent = list(range(count))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for u, v, cls in zip(graph["edge_u"], graph["edge_v"], graph["edge_cls"]):
        if cls in MOTOR_CLASSES or cls == CONNECTOR:
            a, b = find(u), find(v)
            if a != b:
                parent[a] = b
    cell = 0.002  # ~220 m
    for attempt in range(2):
        members: dict[int, list[int]] = defaultdict(list)
        for node in range(count):
            members[find(node)].append(node)
        main = max(members, key=lambda root: len(members[root]))
        grid: dict[tuple[int, int], list[int]] = defaultdict(list)
        for node in members[main]:
            grid[(int(node_lon[node] // cell), int(node_lat[node] // cell))].append(node)
        max_ring = int(APPROXIMATE_MAX_METERS / (cell * geo.METERS_PER_DEGREE)) + 1
        linked = 0
        for root, nodes in sorted(members.items(), key=lambda item: -len(item[1])):
            if root == main or len(nodes) < APPROXIMATE_MIN_NODES:
                continue
            best = None
            for node in nodes[:: max(1, len(nodes) // 80)]:
                found = _nearest_in_grid(grid, cell, max_ring, node_lon[node], node_lat[node], node_lon, node_lat)
                if found and found[0] <= APPROXIMATE_MAX_METERS and (best is None or found[0] < best[0]):
                    best = (found[0], node, found[1])
            if not best:
                continue
            distance, node, other = best
            if not _over_land(node_lon[node], node_lat[node], node_lon[other], node_lat[other], distance, is_land):
                stats["approximate_links_over_water"] += 1
                continue
            graph["edge_u"].append(node)
            graph["edge_v"].append(other)
            graph["edge_len"].append(max(0.1, distance))
            graph["edge_cls"].append(CONNECTOR)
            graph["edge_flags"].append(FLAG_APPROXIMATE)
            graph["edge_name"].append(-1)
            graph["edge_ref"].append(-1)
            graph["edge_parish"].append(-1)
            graph["shape_off"].append(graph["shape_off"][-1])
            parent[find(node)] = find(other)
            linked += 1
            stats["approximate_links"] += 1
            stats["approximate_link_meters"] += int(distance)
        if linked == 0:
            break
    stats["edges"] = len(graph["edge_u"])


def link_loose_ends(graph: dict[str, Any], is_land, stats: dict[str, int]) -> None:
    """Joins the state roads that stop short of the roads they lead to.

    The state layer leaves out many urban stretches of its highways and the census only maps the
    blocks of each town, so a highway can end hundreds of metres before the streets of the town it
    crosses (the E30 before Pelileo) and routes take a detour of a hundred kilometres. Every loose end
    (nothing within STATE_SNAP_METERS, STATE_GAP_METERS or CONNECT_METERS) gets one straight link
    (FLAG_APPROXIMATE), over land, to the nearest node of the main network within LOOSE_END_METERS that
    the network does not already reach within DETOUR_FACTOR times the distance (+ DETOUR_SLACK_METERS);
    failing that, to the nearest node of the same numbered road within APPROXIMATE_MAX_METERS.
    """
    loose = graph.pop("loose_state_ends", [])
    if not loose:
        return
    node_lon, node_lat = graph["node_lon"], graph["node_lat"]
    edge_u, edge_v, edge_len = graph["edge_u"], graph["edge_v"], graph["edge_len"]
    count = len(node_lon)
    motor = [cls in MOTOR_CLASSES or cls == CONNECTOR for cls in graph["edge_cls"]]
    offsets = array("l", [0]) * (count + 1)
    for edge, (u, v) in enumerate(zip(edge_u, edge_v)):
        if motor[edge]:
            offsets[u + 1] += 1
            offsets[v + 1] += 1
    for node in range(count):
        offsets[node + 1] += offsets[node]
    targets = array("l", [0]) * offsets[count]
    lengths = array("d", [0.0]) * offsets[count]
    fill = array("l", offsets)
    for edge, (u, v) in enumerate(zip(edge_u, edge_v)):
        if motor[edge]:
            for a, b in ((u, v), (v, u)):
                targets[fill[a]] = b
                lengths[fill[a]] = edge_len[edge]
                fill[a] += 1
    del fill, motor
    extra: dict[int, list[tuple[int, float]]] = defaultdict(list)  # links added below

    parent = list(range(count))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for node in range(count):
        for k in range(offsets[node], offsets[node + 1]):
            a, b = find(node), find(targets[k])
            if a != b:
                parent[a] = b
    sizes: dict[int, int] = defaultdict(int)
    for node in range(count):
        sizes[find(node)] += 1
    main = max(sizes, key=lambda root: sizes[root])
    cell = 0.002  # ~220 m
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for node in range(count):
        if offsets[node + 1] > offsets[node] and find(node) == main:
            grid[(int(node_lon[node] // cell), int(node_lat[node] // cell))].append(node)
    wanted_refs = {ref for _, ref in loose if ref >= 0}
    same_road: dict[int, list[int]] = defaultdict(list)
    for edge, ref in enumerate(graph["edge_ref"]):
        if ref in wanted_refs:
            for node in (edge_u[edge], edge_v[edge]):
                if find(node) == main:
                    same_road[ref].append(node)

    def reach(start: int, limit: float) -> dict[int, float]:
        best = {start: 0.0}
        queue = [(0.0, start)]
        while queue:
            distance, node = heapq.heappop(queue)
            if distance > best[node]:
                continue
            neighbours = [(targets[k], lengths[k]) for k in range(offsets[node], offsets[node + 1])]
            for other, length in neighbours + extra.get(node, []):
                total = distance + length
                if total <= limit and total < best.get(other, math.inf):
                    best[other] = total
                    heapq.heappush(queue, (total, other))
        return best

    def near(lon: float, lat: float, radius: float) -> list[tuple[float, int]]:
        cx, cy = int(lon // cell), int(lat // cell)
        rings = int(radius / (cell * geo.METERS_PER_DEGREE)) + 1
        found = []
        for dx in range(-rings, rings + 1):
            for dy in range(-rings, rings + 1):
                for other in grid.get((cx + dx, cy + dy), ()):
                    distance = geo.haversine(lon, lat, node_lon[other], node_lat[other])
                    if distance <= radius:
                        found.append((distance, other))
        return sorted(found)

    def along(ref: int, lon: float, lat: float, radius: float) -> list[tuple[float, int]]:
        found = set()
        for other in same_road.get(ref, ()):
            distance = geo.haversine(lon, lat, node_lon[other], node_lat[other])
            if distance <= radius:
                found.add((distance, other))
        return sorted(found)

    for node, ref in loose:
        lon, lat = node_lon[node], node_lat[node]
        link = None
        over_water = False
        for kind, options in (("loose_end_links", lambda: near(lon, lat, LOOSE_END_METERS)),
                              ("same_road_links", lambda: along(ref, lon, lat, APPROXIMATE_MAX_METERS))):
            candidates = [(distance, other) for distance, other in options() if other != node]
            if not candidates:
                continue
            reached = reach(node, DETOUR_FACTOR * candidates[-1][0] + DETOUR_SLACK_METERS)
            for distance, other in candidates:
                known = reached.get(other)
                if known is not None and known <= DETOUR_FACTOR * distance + DETOUR_SLACK_METERS:
                    continue
                if not _over_land(lon, lat, node_lon[other], node_lat[other], distance, is_land):
                    over_water = True
                    continue
                link = (kind, distance, other)
                break
            if link:
                break
        if not link:
            if over_water:
                stats["loose_end_links_over_water"] += 1
            continue
        kind, distance, other = link
        graph["edge_u"].append(node)
        graph["edge_v"].append(other)
        graph["edge_len"].append(max(0.1, distance))
        graph["edge_cls"].append(CONNECTOR)
        graph["edge_flags"].append(FLAG_APPROXIMATE)
        graph["edge_name"].append(-1)
        graph["edge_ref"].append(-1)
        graph["edge_parish"].append(-1)
        graph["shape_off"].append(graph["shape_off"][-1])
        extra[node].append((other, distance))
        extra[other].append((node, distance))
        stats[kind] += 1
        stats["loose_end_link_meters"] += int(distance)
    stats["edges"] = len(graph["edge_u"])
    log(f"loose state-road ends: {len(loose)}, joined {stats['loose_end_links']} to a nearby road and "
        f"{stats['same_road_links']} to the same road ({stats['loose_end_links_over_water']} only over water)")


def _nearest_in_grid(grid, cell: float, max_ring: int, lon: float, lat: float, node_lon, node_lat):
    """(meters, node) of the nearest grid node, scanning rings of cells outwards."""
    cx, cy = int(lon // cell), int(lat // cell)
    ring_meters = cell * geo.METERS_PER_DEGREE
    best = None
    for ring in range(max_ring + 1):
        for dx in range(-ring, ring + 1):
            for dy in (range(-ring, ring + 1) if abs(dx) == ring else (-ring, ring)):
                for other in grid.get((cx + dx, cy + dy), ()):
                    distance = geo.haversine(lon, lat, node_lon[other], node_lat[other])
                    if best is None or distance < best[0]:
                        best = (distance, other)
        if best and best[0] <= ring * ring_meters:
            break
    return best


def _over_land(lon1: float, lat1: float, lon2: float, lat2: float, distance: float, is_land) -> bool:
    steps = max(1, int(distance // LAND_STEP_METERS))
    for k in range(1, steps):
        f = k / steps
        if not is_land(lon1 + (lon2 - lon1) * f, lat1 + (lat2 - lat1) * f):
            return False
    return True


def _nearest_junction(junctions, lon: float, lat: float):
    cx, cy = int(_mx(lon) // 100), int(_my(lat) // 100)
    best = None
    for ax in (cx - 1, cx, cx + 1):
        for ay in (cy - 1, cy, cy + 1):
            for olon, olat in junctions.get((ax, ay), ()):
                distance = geo.haversine(lon, lat, olon, olat)
                if distance <= CONNECT_METERS and (best is None or distance < best[0]):
                    best = (distance, olon, olat)
    return (best[1], best[2]) if best else None


def components(graph: dict[str, Any]) -> list[int]:
    """Sizes of the connected components for motor vehicles, biggest first."""
    parent = list(range(len(graph["node_lon"])))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for u, v, cls in zip(graph["edge_u"], graph["edge_v"], graph["edge_cls"]):
        if cls in MOTOR_CLASSES or cls == CONNECTOR:
            a, b = find(u), find(v)
            if a != b:
                parent[a] = b
    sizes: dict[int, int] = defaultdict(int)
    for x in range(len(parent)):
        sizes[find(x)] += 1
    return sorted(sizes.values(), reverse=True)


# ---------------------------------------------------------------- output


def write_graph(graph: dict[str, Any], names: Strings, parishes: list[dict[str, Any]], destination: Path,
                meta: dict[str, Any]) -> dict[str, Any]:
    """graph.bin = b"RMGRAPH2" + uint32 LE header length + UTF-8 JSON header, padded with spaces to a
    multiple of 8; then the sections, each at `dataOffset + offset` (8-byte aligned), little endian."""
    names_blob = bytearray()
    names_off = array("L", [0])
    for value in names.values:
        names_blob += value.encode("utf-8")
        names_off.append(len(names_blob))
    sections = [
        ("node_lon", "int32", array("l", (round(v * 1e7) for v in graph["node_lon"]))),
        ("node_lat", "int32", array("l", (round(v * 1e7) for v in graph["node_lat"]))),
        ("edge_u", "int32", graph["edge_u"]), ("edge_v", "int32", graph["edge_v"]),
        ("edge_len", "float32", graph["edge_len"]), ("edge_cls", "uint8", graph["edge_cls"]),
        ("edge_flags", "uint8", graph["edge_flags"]), ("edge_name", "int32", graph["edge_name"]),
        ("edge_ref", "int32", graph["edge_ref"]), ("edge_parish", "int32", graph["edge_parish"]),
        ("shape_off", "uint32", graph["shape_off"]), ("shape_lon", "int32", graph["shape_lon"]),
        ("shape_lat", "int32", graph["shape_lat"]), ("names_off", "uint32", names_off),
        ("names", "uint8", array("B", names_blob)),
    ]
    body = bytearray()
    layout = []
    for name, dtype, values in sections:
        body += b"\0" * ((8 - len(body) % 8) % 8)
        layout.append({"name": name, "type": dtype, "offset": len(body), "length": len(values)})
        body += _little_endian(values, dtype)
    header = {
        "format": "route-maps-graph", "version": 2, "classes": list(CLASSES),
        "flags": {"roundabout": FLAG_ROUNDABOUT, "stateRoad": FLAG_STATE_ROAD, "unpaved": FLAG_UNPAVED,
                  "tunnel": FLAG_TUNNEL, "approximate": FLAG_APPROXIMATE},
        "counts": {"nodes": len(graph["node_lon"]), "edges": len(graph["edge_u"]), "names": len(names.values)},
        "parishes": parishes, "sections": layout, **meta,
    }
    encoded = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    prefix = b"RMGRAPH2" + struct.pack("<I", len(encoded)) + encoded
    prefix += b" " * ((8 - len(prefix) % 8) % 8)
    target = destination / "graph.bin"
    temporary = destination / ".graph.bin.part"
    with temporary.open("wb") as handle:
        handle.write(prefix)
        handle.write(body)
    temporary.replace(target)
    summary = {"format": header["format"], "version": header["version"], "counts": header["counts"], **meta}
    (destination / "graph.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
                                            encoding="utf-8", newline="\n")
    return header


def _little_endian(values: array, dtype: str) -> bytes:
    code = {"int32": "i", "uint32": "I", "float32": "f", "uint8": "B"}[dtype]
    converted = values if values.typecode == code else array(code, values)
    if sys.byteorder != "little" and converted.itemsize > 1:
        converted = array(code, converted)
        converted.byteswap()
    return converted.tobytes()


def write_map_roads(lines: Lines, state_parts: Lines, overview: Lines, names: Strings, kinds: dict[int, str],
                    destination: Path) -> int:
    """map-roads.geojson for the tiles: streets and the state-road stretches no street duplicates at every
    zoom (`detail`) and the complete state network for the low zooms (`overview`)."""
    target = destination / "map-roads.geojson"
    temporary = destination / ".map-roads.geojson.part"
    count = 0
    with temporary.open("w", encoding="utf-8", newline="\n") as out:
        out.write('{"type":"FeatureCollection","features":[\n')

        def write(props: dict[str, Any], coordinates) -> None:
            nonlocal count
            feature = {"type": "Feature", "properties": props,
                       "geometry": {"type": "LineString", "coordinates": coordinates}}
            out.write(("," if count else "") + json.dumps(feature, ensure_ascii=False, separators=(",", ":")) + "\n")
            count += 1

        for collection, scope in ((lines, "detail"), (state_parts, "detail"), (overview, "overview")):
            for line in range(len(collection)):
                if collection.source[line] == SOURCE_CONNECTOR:
                    continue
                if collection is lines and collection.source[line] == SOURCE_STATE_ROAD:
                    continue  # whole state roads route; only their unduplicated stretches are drawn
                props: dict[str, Any] = {"class": CLASSES[collection.cls[line]], "scope": scope}
                if collection is lines and line in kinds:
                    props["kind"] = kinds[line]
                if collection.source[line] == SOURCE_STATE_ROAD:
                    props["state"] = True
                elif collection.name[line] >= 0:
                    props["name"] = names.values[collection.name[line]]
                if collection.ref[line] >= 0:
                    props["ref"] = names.values[collection.ref[line]]
                if collection.flags[line] & FLAG_UNPAVED:
                    props["surface"] = "unpaved"
                if collection.flags[line] & FLAG_ROUNDABOUT:
                    props["roundabout"] = True
                if collection.flags[line] & FLAG_TUNNEL:
                    props["brunnel"] = "tunnel"
                write(props, [[collection.lon[i], collection.lat[i]]
                              for i in range(collection.start[line], collection.start[line + 1])])
        out.write("]}\n")
    temporary.replace(target)
    return count


def build(destination: Path, street_features: Iterable[dict[str, Any]], state_roads: Path, speller: Speller,
          parish_names: dict[str, dict[str, str]], meta: dict[str, Any], is_land=None) -> dict[str, Any]:
    names, parishes = Strings(), Strings()
    lines = Lines()
    kinds: dict[int, str] = {}
    stats: dict[str, int] = defaultdict(int)
    stats.update(load_streets(street_features, lines, names, parishes, speller, kinds))
    street_count = len(lines)
    stats["state_road_lines"] = load_state_roads(state_roads, lines, names, speller)
    log(f"loaded {street_count} street lines and {stats['state_road_lines']} state-road lines")
    overview = Lines()
    for line in range(street_count, len(lines)):
        overview.copy_line(lines, line)
    lines, state_parts = conflate(lines, street_count, stats)
    log("state roads conflated with the streets")
    graph = build_graph(lines, stats)
    if is_land is not None:
        bridge_components(graph, is_land, stats)
        link_loose_ends(graph, is_land, stats)
    graph.pop("loose_state_ends", None)
    sizes = components(graph)
    stats["components"] = len(sizes)
    stats["largest_component_nodes"] = sizes[0] if sizes else 0
    log(f"graph: {stats['nodes']} nodes, {stats['edges']} edges, {len(sizes)} components "
        f"(largest {stats['largest_component_nodes']})")
    parish_table = [{"code": code, **(parish_names.get(code) or {})} for code in parishes.values]
    header = write_graph(graph, names, parish_table, destination, {**meta, "stats": dict(stats)})
    stats["map_features"] = write_map_roads(lines, state_parts, overview, names, kinds, destination)
    return {"stats": dict(stats), "counts": header["counts"]}
