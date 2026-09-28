#!/usr/bin/env python3
"""Generates style.json (web viewer, SDK) and the mobile copy from one readable definition.

    python infrastructure/maps/style/build-style.py

Light "street map" look: grey land, white streets with a soft casing, warm highways, green
parks, blue water, category colours for points of interest (icons are drawn by the clients
from the `poi-<class>` image names) and optional overlays (climate, population heat map) that
start hidden and are switched on by the clients.
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGETS = [HERE / "style.json", HERE.parents[2] / "mobile" / "assets" / "map" / "style.json"]

SOURCE = "basemap"
REGULAR = ["Noto Sans Regular"]
MEDIUM = ["Noto Sans Medium"]
ITALIC = ["Noto Sans Italic"]

LAND = "#eef0f2"
URBAN = "#e6e8eb"
BLOCK = "#f7f8f9"
BUILDING = "#e3e5e8"
BUILDING_LINE = "#d5d8dc"
WATER = "#aadaff"
WATER_TEXT = "#3f7bb3"
PARK = "#c7e7c9"
SPORTS = "#cfe9cf"
CEMETERY = "#d6e6d3"
SQUARE = "#f5f6f7"
CASING = "#d3d6db"
HALO = "#ffffff"

ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "track"]
FILL = {"motorway": "#fcd57b", "trunk": "#fde5a3", "primary": "#ffffff", "secondary": "#ffffff",
        "tertiary": "#ffffff", "minor": "#ffffff", "service": "#ffffff", "track": "#fbfbfb"}
EDGE = {"motorway": "#e9ab2d", "trunk": "#e8c064", "primary": "#cfd3d8", "secondary": "#d3d6db",
        "tertiary": CASING, "minor": CASING, "service": "#dcdfe3", "track": "#d7cfc3"}
# Road width (px) by zoom for the fill; the casing adds WIDTH_CASING on each side.
WIDTH = {
    "motorway": {5: 0.8, 8: 1.4, 10: 2.2, 12: 3.4, 14: 6.0, 16: 12, 18: 28},
    "trunk": {5: 0.6, 8: 1.2, 10: 2.0, 12: 3.0, 14: 5.5, 16: 11, 18: 26},
    "primary": {7: 0.5, 10: 1.4, 12: 2.6, 14: 5.0, 16: 10, 18: 24},
    "secondary": {11: 1.0, 12: 2.0, 14: 4.4, 16: 9, 18: 22},
    "tertiary": {12: 0.8, 13: 1.5, 14: 3.2, 16: 7, 18: 18},
    "minor": {13: 0.8, 14: 2.4, 16: 6, 18: 16},
    "service": {14: 1.2, 16: 3.5, 18: 9},
    "track": {13: 0.6, 14: 1.2, 16: 3, 18: 7},
}
WIDTH_CASING = {"motorway": 1.2, "trunk": 1.1, "primary": 1.0, "secondary": 1.0, "tertiary": 0.8, "minor": 0.8,
                "service": 0.6, "track": 0.6}

# Points of interest: icon/label colour by class.
POI_COLORS = {
    "restaurant": "#e8710a", "shop": "#1a73e8", "hospital": "#d93025", "pharmacy": "#d93025",
    "school": "#5c6bc0", "college": "#5c6bc0", "library": "#12b5cb", "park": "#188038", "sports": "#188038",
    "stadium": "#188038", "cemetery": "#5f7d62", "bus": "#1a73e8", "airport": "#1a73e8", "rail": "#1a73e8",
    "ferry": "#1a73e8", "fuel": "#1a73e8", "lodging": "#d01884", "bank": "#5c6bc0", "museum": "#12b5cb",
    "theatre": "#12b5cb", "cinema": "#12b5cb", "attraction": "#12b5cb", "place_of_worship": "#70757a",
    "town_hall": "#70757a", "government": "#70757a", "police": "#70757a", "fire_station": "#70757a",
    "post": "#70757a", "military": "#70757a", "community": "#70757a", "building": "#70757a",
}
POI_TEXT = {key: value for key, value in POI_COLORS.items()}
POI_TEXT.update({"park": "#137333", "sports": "#137333", "stadium": "#137333", "cemetery": "#4e6b51",
                 "restaurant": "#c5530a", "museum": "#0e8a9b", "theatre": "#0e8a9b", "cinema": "#0e8a9b",
                 "attraction": "#0e8a9b", "library": "#0e8a9b"})
DEFAULT_POI = "#70757a"

# Overlays (hidden until the client switches them on).
PRECIPITATION = [[0, "#fff4d6"], [500, "#e5f1c9"], [1000, "#c2e3c4"], [2000, "#8fd0d1"],
                 [3000, "#5aaed8"], [4000, "#3d7fc7"], [6000, "#2c4f9e"]]
TEMPERATURE = {1: "#dcd6f7", 2: "#c7ddf5", 3: "#cdeee0", 4: "#f6f2c2", 5: "#fbd3a1", 6: "#f7a88c"}


def get(field):
    return ["get", field]


def by_class(values: dict, fallback):
    expression = ["match", get("class")]
    for key, value in values.items():
        expression += [key, value]
    return expression + [fallback]


def interpolate(stops: dict, base=1.4):
    expression = ["interpolate", ["exponential", base], ["zoom"]]
    for zoom, value in sorted(stops.items()):
        expression += [zoom, value]
    return expression


def name_field():
    return ["coalesce", get("name_es"), get("name")]


def layers() -> list[dict]:
    out: list[dict] = [{"id": "background", "type": "background", "paint": {"background-color": LAND}}]

    out += [
        {"id": "landuse-urban", "type": "fill", "source": SOURCE, "source-layer": "landuse", "maxzoom": 14,
         "filter": ["in", get("class"), ["literal", ["residential", "commercial", "industrial", "construction"]]],
         "paint": {"fill-color": URBAN, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 0.9, 13, 0.6]}},
        {"id": "landuse-natural", "type": "fill", "source": SOURCE, "source-layer": "landuse",
         "filter": ["in", get("class"), ["literal", ["forest", "grass", "scrub", "farmland", "wetland", "sand", "rock",
                                                      "glacier"]]],
         "paint": {"fill-color": by_class({"forest": "#d4e8c4", "grass": "#dcedc8", "scrub": "#dde9c8",
                                           "farmland": "#eef1dc", "wetland": "#d4e9e2", "sand": "#f3ecd4",
                                           "rock": "#e6e3dd", "glacier": "#f4f9fc"}, "#dcedc8"),
                   "fill-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.6, 12, 1]}},
        {"id": "landuse-block", "type": "fill", "source": SOURCE, "source-layer": "landuse", "minzoom": 13,
         "filter": ["==", get("class"), "block"],
         "paint": {"fill-color": BLOCK, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.5, 15, 1]}},
        {"id": "landuse-amenity", "type": "fill", "source": SOURCE, "source-layer": "landuse",
         "filter": ["in", get("class"), ["literal", ["cemetery", "hospital", "school", "sports", "parking", "aerodrome",
                                                      "apron", "pedestrian"]]],
         "paint": {"fill-color": by_class({"cemetery": CEMETERY, "hospital": "#f9e1e0", "school": "#eeeaf8",
                                           "sports": SPORTS, "parking": "#eceff1", "aerodrome": "#e8eaf1",
                                           "apron": "#dfe2ea", "pedestrian": SQUARE}, "#eceff1")}},
        {"id": "landuse-park", "type": "fill", "source": SOURCE, "source-layer": "landuse",
         "filter": ["==", get("class"), "park"],
         "paint": {"fill-color": PARK, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.7, 13, 1]}},
        {"id": "water", "type": "fill", "source": SOURCE, "source-layer": "water", "paint": {"fill-color": WATER}},
        {"id": "waterway-river", "type": "line", "source": SOURCE, "source-layer": "waterway",
         "filter": ["all", ["in", get("class"), ["literal", ["river", "canal"]]], ["!=", get("brunnel"), "tunnel"]],
         "layout": {"line-cap": "round", "line-join": "round"},
         "paint": {"line-color": WATER, "line-width": interpolate({8: 0.6, 12: 1.6, 14: 3, 18: 12}, 1.3)}},
        {"id": "waterway-stream", "type": "line", "source": SOURCE, "source-layer": "waterway", "minzoom": 12,
         "filter": ["all", ["in", get("class"), ["literal", ["stream", "drain"]]], ["!=", get("brunnel"), "tunnel"]],
         "layout": {"line-cap": "round", "line-join": "round"},
         "paint": {"line-color": WATER, "line-width": interpolate({12: 0.5, 14: 1, 18: 3}, 1.3)}},
        {"id": "building", "type": "fill", "source": SOURCE, "source-layer": "building", "minzoom": 14,
         "paint": {"fill-color": BUILDING, "fill-outline-color": BUILDING_LINE,
                   "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.35, 16, 1]}},
        {"id": "aeroway-runway", "type": "line", "source": SOURCE, "source-layer": "transportation",
         "filter": ["==", get("class"), "runway"],
         "paint": {"line-color": "#dadce0", "line-width": interpolate({10: 1, 14: 14, 18: 70}, 1.5)}},
    ]

    # Paths (pedestrian, trails, steps) under the roads.
    out.append({
        "id": "road-path", "type": "line", "source": SOURCE, "source-layer": "transportation", "minzoom": 14,
        "filter": ["==", get("class"), "path"],
        "layout": {"line-join": "round"},
        "paint": {"line-color": ["match", get("subclass"), "steps", "#b0a898", "#b9b3aa"],
                  "line-width": interpolate({14: 0.8, 16: 1.6, 18: 3}, 1.3), "line-dasharray": [2, 1.4]},
    })

    # Roads: tunnels, casings, fills, bridges (one layer each, drawing order by class).
    sort_key = ["match", get("class")] + sum(([cls, index] for index, cls in enumerate(reversed(ROAD_CLASSES))), []) + [0]
    road_filter = ["in", get("class"), ["literal", ROAD_CLASSES]]
    # MapLibre needs the zoom interpolation outermost: one class match per zoom stop.
    zooms = sorted({zoom for stops in WIDTH.values() for zoom in stops} | {5, 18})

    def width_expression(casing: bool):
        expression = ["interpolate", ["exponential", 1.4], ["zoom"]]
        for zoom in zooms:
            match = ["match", get("class")]
            for cls in ROAD_CLASSES:
                stops = WIDTH[cls]
                value = _at(stops, zoom)
                if casing and value > 0:
                    value += 2 * WIDTH_CASING[cls] * (0.4 if zoom < 12 else 1)
                match += [cls, round(value, 2)]
            expression += [zoom, match + [0]]
        return expression

    out += [
        {"id": "road-tunnel", "type": "line", "source": SOURCE, "source-layer": "transportation", "minzoom": 12,
         "filter": ["all", road_filter, ["==", get("brunnel"), "tunnel"]],
         "layout": {"line-join": "round", "line-sort-key": sort_key},
         "paint": {"line-color": "#f3f4f6", "line-width": width_expression(False), "line-opacity": 0.8,
                   "line-dasharray": [1, 0.6]}},
        {"id": "road-casing", "type": "line", "source": SOURCE, "source-layer": "transportation", "minzoom": 10,
         "filter": ["all", road_filter, ["!", ["in", get("brunnel"), ["literal", ["tunnel", "bridge"]]]]],
         "layout": {"line-join": "round", "line-cap": "round", "line-sort-key": sort_key},
         "paint": {"line-color": by_class(EDGE, CASING), "line-width": width_expression(True)}},
        {"id": "road", "type": "line", "source": SOURCE, "source-layer": "transportation",
         "filter": ["all", road_filter, ["!", ["in", get("brunnel"), ["literal", ["tunnel", "bridge"]]]]],
         "layout": {"line-join": "round", "line-cap": "round", "line-sort-key": sort_key},
         "paint": {"line-color": ["case", ["==", get("surface"), "unpaved"], "#f2ece0", by_class(FILL, "#ffffff")],
                   "line-width": width_expression(False)}},
        {"id": "road-bridge-casing", "type": "line", "source": SOURCE, "source-layer": "transportation",
         "minzoom": 12, "filter": ["all", road_filter, ["==", get("brunnel"), "bridge"]],
         "layout": {"line-join": "round", "line-sort-key": sort_key},
         "paint": {"line-color": "#b9bdc3", "line-width": width_expression(True)}},
        {"id": "road-bridge", "type": "line", "source": SOURCE, "source-layer": "transportation", "minzoom": 12,
         "filter": ["all", road_filter, ["==", get("brunnel"), "bridge"]],
         "layout": {"line-join": "round", "line-sort-key": sort_key},
         "paint": {"line-color": by_class(FILL, "#ffffff"), "line-width": width_expression(False)}},
        {"id": "rail", "type": "line", "source": SOURCE, "source-layer": "transportation",
         "filter": ["in", get("class"), ["literal", ["rail", "transit"]]],
         "paint": {"line-color": "#b8bcc2", "line-width": interpolate({9: 0.6, 14: 2, 18: 4}, 1.3)}},
        {"id": "ferry", "type": "line", "source": SOURCE, "source-layer": "transportation",
         "filter": ["==", get("class"), "ferry"],
         "paint": {"line-color": "#6aa6e8", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.6, 14, 1.5],
                   "line-dasharray": [3, 2]}},
    ]

    out += [
        {"id": "boundary-other", "type": "line", "source": SOURCE, "source-layer": "boundary", "minzoom": 10,
         "filter": ["all", [">", get("admin_level"), 4], ["!=", get("maritime"), True]],
         "paint": {"line-color": "#c3c7cd", "line-width": 0.8, "line-dasharray": [2, 2]}},
        {"id": "boundary-state", "type": "line", "source": SOURCE, "source-layer": "boundary",
         "filter": ["all", [">", get("admin_level"), 2], ["<=", get("admin_level"), 4], ["!=", get("maritime"), True]],
         "paint": {"line-color": "#a9adb5", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 12, 1.3, 16, 2],
                   "line-dasharray": [3, 2]}},
        {"id": "boundary-country", "type": "line", "source": SOURCE, "source-layer": "boundary",
         "filter": ["all", ["<=", get("admin_level"), 2], ["!=", get("maritime"), True], ["!=", get("disputed"), True]],
         "paint": {"line-color": "#8e939b", "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 10, 1.5, 16, 2.5]}},
        {"id": "boundary-country-disputed", "type": "line", "source": SOURCE, "source-layer": "boundary",
         "filter": ["all", ["<=", get("admin_level"), 2], ["!=", get("maritime"), True], ["==", get("disputed"), True]],
         "paint": {"line-color": "#8e939b", "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 10, 1.5, 16, 2.5],
                   "line-dasharray": [2, 2]}},
    ]

    # Overlays: hidden by default, switched on by the clients ("Capas").
    precipitation = ["interpolate", ["linear"], ["coalesce", get("mm_max"), 0]]
    for value, color in PRECIPITATION:
        precipitation += [value, color]
    out += [
        {"id": "overlay-precipitation", "type": "fill", "source": SOURCE, "source-layer": "climate",
         "filter": ["==", get("class"), "precipitation"], "layout": {"visibility": "none"},
         "paint": {"fill-color": precipitation, "fill-opacity": 0.55, "fill-outline-color": "#ffffff"}},
        {"id": "overlay-temperature", "type": "fill", "source": SOURCE, "source-layer": "climate",
         "filter": ["==", get("class"), "temperature"], "layout": {"visibility": "none"},
         "paint": {"fill-color": ["match", get("band"), *sum(([band, color] for band, color in TEMPERATURE.items()), []),
                                  "#eeeeee"],
                   "fill-opacity": 0.55}},
        {"id": "overlay-population", "type": "heatmap", "source": SOURCE, "source-layer": "population",
         "maxzoom": 15, "layout": {"visibility": "none"},
         "paint": {
             "heatmap-weight": ["interpolate", ["linear"], get("pop"), 0, 0, 2000, 0.35, 10000, 0.8, 30000, 1],
             "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 4, 0.6, 9, 1.2, 12, 2],
             "heatmap-radius": ["interpolate", ["exponential", 2], ["zoom"], 4, 3, 8, 12, 11, 40, 13, 90],
             "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(33,102,172,0)",
                               0.15, "rgba(103,169,207,0.55)", 0.35, "rgba(209,229,240,0.7)",
                               0.55, "rgba(253,219,199,0.8)", 0.75, "rgba(239,138,98,0.85)",
                               1, "rgba(178,24,43,0.9)"],
             "heatmap-opacity": 0.85,
         }},
    ]

    # Labels.
    out += [
        {"id": "waterway-label", "type": "symbol", "source": SOURCE, "source-layer": "waterway", "minzoom": 10,
         "filter": ["all", ["in", get("class"), ["literal", ["river", "canal"]]], ["has", "name"]],
         "layout": {"symbol-placement": "line", "text-field": name_field(), "text-font": ITALIC,
                    "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 16, 13], "text-letter-spacing": 0.1,
                    "symbol-spacing": 350},
         "paint": {"text-color": WATER_TEXT, "text-halo-color": HALO, "text-halo-width": 1.2}},
        {"id": "water-name", "type": "symbol", "source": SOURCE, "source-layer": "water_name",
         "layout": {"text-field": name_field(), "text-font": ITALIC,
                    "text-size": ["match", get("class"), "ocean", 16, "sea", 14, 12], "text-max-width": 8,
                    "text-letter-spacing": 0.1},
         "paint": {"text-color": WATER_TEXT, "text-halo-color": "rgba(255,255,255,0.7)", "text-halo-width": 1}},
        {"id": "road-label", "type": "symbol", "source": SOURCE, "source-layer": "transportation", "minzoom": 12,
         "filter": ["all", ["has", "name"], ["in", get("class"), ["literal", ROAD_CLASSES + ["path"]]]],
         "layout": {"symbol-placement": "line", "text-field": name_field(), "text-font": REGULAR,
                    "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9.5, 15, 11, 17, 13, 19, 15],
                    "symbol-spacing": 280, "text-max-angle": 30, "text-padding": 2,
                    "symbol-sort-key": ["-", 10, ["match", get("class"), "motorway", 7, "trunk", 6, "primary", 5,
                                                  "secondary", 4, "tertiary", 3, "minor", 2, "service", 1, 0]]},
         "paint": {"text-color": "#5f6368", "text-halo-color": HALO, "text-halo-width": 1.6}},
        {"id": "road-ref", "type": "symbol", "source": SOURCE, "source-layer": "transportation", "minzoom": 7,
         "filter": ["all", ["has", "ref"], ["in", get("class"), ["literal", ["motorway", "trunk", "primary"]]]],
         "layout": {"symbol-placement": "line", "text-field": get("ref"), "text-font": MEDIUM, "text-size": 10,
                    "symbol-spacing": 420, "text-rotation-alignment": "viewport", "text-padding": 4},
         "paint": {"text-color": "#6b4c00", "text-halo-color": "#fff3cc", "text-halo-width": 2.4}},
    ]

    def poi_layer(layer_id: str, filter_: list) -> dict:
        return {
            "id": layer_id, "type": "symbol", "source": SOURCE, "source-layer": "poi", "minzoom": 12,
            "filter": filter_,
            "layout": {
                "icon-image": ["concat", "poi-", get("class")],
                "icon-size": ["interpolate", ["linear"], ["zoom"], 12, 0.75, 16, 1],
                "icon-allow-overlap": False,
                "text-field": ["case", ["has", "name"], name_field(), ""],
                "text-font": MEDIUM,
                "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10.5, 17, 12.5],
                "text-max-width": 9,
                "text-variable-anchor": ["left", "right", "top", "bottom"],
                "text-radial-offset": 1.1,
                "text-justify": "auto",
                "text-optional": True,
                "symbol-sort-key": get("rank"),
                "text-padding": 3,
            },
            "paint": {"text-color": by_class(POI_TEXT, DEFAULT_POI), "text-halo-color": HALO,
                      "text-halo-width": 1.5},
        }

    # Like a map search engine: the density grows with the zoom (terminals and hospitals first,
    # schools and churches from 16, doctors' offices only from 18). Major places are placed before
    # the street names, minor ones after them, so the streets keep their labels.
    visible_rank = ["any", ["<=", get("rank"), 8],
                    ["all", [">=", ["zoom"], 13], ["<=", get("rank"), 12]],
                    ["all", [">=", ["zoom"], 14], ["<=", get("rank"), 14]],
                    ["all", [">=", ["zoom"], 15], ["<=", get("rank"), 16]],
                    ["all", [">=", ["zoom"], 16], ["<=", get("rank"), 20]],
                    ["all", [">=", ["zoom"], 17], ["<=", get("rank"), 24]],
                    [">=", ["zoom"], 18]]
    major_poi = poi_layer("poi-major", ["all", ["<=", get("rank"), 12], visible_rank])
    minor_poi = poi_layer("poi", ["all", [">", get("rank"), 12], visible_rank])
    road_label = next(index for index, layer in enumerate(out) if layer["id"] == "road-label")
    out.insert(road_label, minor_poi)
    out.append(major_poi)

    def place(layer_id, classes, minzoom, font, sizes, color, halo=1.8, upper=False, maxzoom=None, spacing=0.0):
        layout = {"text-field": name_field(), "text-font": font, "text-size": ["interpolate", ["linear"], ["zoom"], *sizes],
                  "text-max-width": 8, "symbol-sort-key": get("rank"), "text-padding": 4}
        if upper:
            layout["text-transform"] = "uppercase"
            layout["text-letter-spacing"] = spacing or 0.1
        layer = {"id": layer_id, "type": "symbol", "source": SOURCE, "source-layer": "place", "minzoom": minzoom,
                 "filter": ["in", get("class"), ["literal", classes]], "layout": layout,
                 "paint": {"text-color": color, "text-halo-color": HALO, "text-halo-width": halo}}
        if maxzoom:
            layer["maxzoom"] = maxzoom
        return layer

    out += [
        place("place-locality", ["locality", "neighbourhood", "quarter", "hamlet"], 12, REGULAR, [12, 10, 16, 12],
              "#80868b"),
        place("place-suburb", ["suburb"], 12, MEDIUM, [12, 10, 16, 12.5], "#70757a", upper=True, spacing=0.08),
        place("place-island", ["island", "islet"], 8, ITALIC, [8, 10, 14, 13], "#4d5a4d"),
        place("place-village", ["village"], 10, REGULAR, [10, 10.5, 16, 14], "#3c4043"),
        place("place-town", ["town"], 7, MEDIUM, [7, 10.5, 12, 13.5, 16, 17], "#3c4043"),
        place("place-city", ["city"], 4, MEDIUM, [4, 11, 8, 14, 12, 18, 16, 22], "#202124", halo=2.2),
        place("place-state", ["state"], 4, REGULAR, [4, 9.5, 8, 12], "#8a8f98", upper=True, maxzoom=10, spacing=0.15),
        place("place-country", ["country"], 2, MEDIUM, [2, 11, 6, 16], "#5f6368", upper=True, maxzoom=8),
    ]
    return out


def _at(stops: dict, zoom: float) -> float:
    keys = sorted(stops)
    if zoom < keys[0]:
        return 0.0
    if zoom >= keys[-1]:
        return float(stops[keys[-1]])
    for low, high in zip(keys, keys[1:]):
        if low <= zoom <= high:
            t = (zoom - low) / (high - low)
            return stops[low] + (stops[high] - stops[low]) * t
    return float(stops[keys[-1]])


def style() -> dict:
    return {
        "version": 8,
        "name": "Maps Platform Light",
        "metadata": {
            "maps-platform:schema": "1.0.0",
            "maps-platform:overlays": {
                "precipitation": ["overlay-precipitation"],
                "temperature": ["overlay-temperature"],
                "population": ["overlay-population"],
            },
            "maps-platform:poi-colors": {**POI_COLORS, "default": DEFAULT_POI},
            "maps-platform:placeholders": {
                "__PMTILES_URL__": "PMTiles archive, e.g. https://host/maps/ecuador/ecuador.pmtiles or file:///...",
                "__GLYPHS_URL__": "Base URL of the glyph folders, e.g. https://host/maps/fonts or file:///.../fonts",
            },
        },
        "sources": {SOURCE: {"type": "vector", "url": "pmtiles://__PMTILES_URL__", "attribution": ""}},
        "glyphs": "__GLYPHS_URL__/{fontstack}/{range}.pbf",
        "layers": layers(),
    }


def main() -> None:
    text = json.dumps(style(), ensure_ascii=False, indent=2) + "\n"
    for target in TARGETS:
        if target.parent.exists():
            target.write_text(text, encoding="utf-8", newline="\n")
            print(f"wrote {target}")


if __name__ == "__main__":
    main()
