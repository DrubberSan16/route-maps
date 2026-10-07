#!/usr/bin/env python3
"""Generates style.json (web viewer, SDK) and the mobile copy from one readable definition.

    python infrastructure/maps/style/build-style.py

Light "street map" look: grey land, white streets with a soft casing, warm highways, green
parks, blue water, category colours for points of interest (icons are drawn by the clients
from the `poi-<class>` image names) and optional overlays (climate, population heat map) that
start hidden and are switched on by the clients.

The metadata describes what the clients add on demand, so that the web viewer, the browser SDK
and the app draw them the same way:

* `maps-platform:map-types`: "Satélite" and "Relieve", made of the region's own raster archives
  (satellite imagery, elevation), where their layers go and how the base layers change;
* `maps-platform:traffic`: the road network that turns green ("sin demoras reportadas") and
  the layers of the measured segments (GET /traffic/flow).
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGETS = [HERE / "style.json", HERE.parents[2] / "mobile" / "assets" / "map" / "style.json"]
# Relief and imagery sources: their licences ask for the citation shown by the map.
SOURCES_CATALOG = HERE.parents[1] / "sources" / "sources.json"

SOURCE = "basemap"
# Population and climate live in their own archive (<region>.overlays.pmtiles), read only when shown.
OVERLAYS = "overlays"
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

# Points of interest: icon/label colour by class. First the classes of the native data, then those
# of the OSM-based tile generator (tilegen PoiLayer), coloured like their native counterparts.
POI_COLORS = {
    "restaurant": "#e8710a", "shop": "#1a73e8", "hospital": "#d93025", "pharmacy": "#d93025",
    "school": "#5c6bc0", "college": "#5c6bc0", "library": "#12b5cb", "park": "#188038", "sports": "#188038",
    "stadium": "#188038", "cemetery": "#5f7d62", "bus": "#1a73e8", "airport": "#1a73e8", "rail": "#1a73e8",
    "ferry": "#1a73e8", "fuel": "#1a73e8", "lodging": "#d01884", "bank": "#5c6bc0", "museum": "#12b5cb",
    "theatre": "#12b5cb", "cinema": "#12b5cb", "attraction": "#12b5cb", "place_of_worship": "#70757a",
    "town_hall": "#70757a", "government": "#70757a", "police": "#70757a", "fire_station": "#70757a",
    "post": "#70757a", "military": "#70757a", "community": "#70757a", "building": "#70757a",
    "food": "#e8710a", "cafe": "#e8710a", "bar": "#e8710a", "mall": "#1a73e8", "market": "#1a73e8",
    "supermarket": "#1a73e8", "grocery": "#1a73e8", "health": "#d93025", "emergency": "#d93025",
    "bus_station": "#1a73e8", "bus_stop": "#1a73e8", "railway_station": "#1a73e8", "transit_station": "#1a73e8",
    "tram_stop": "#1a73e8", "ferry_terminal": "#1a73e8", "taxi": "#1a73e8", "parking": "#1a73e8",
    "charging_station": "#1a73e8", "culture": "#12b5cb", "historic": "#12b5cb", "worship": "#70757a",
    "playground": "#188038", "campsite": "#188038",
}
POI_TEXT = {key: value for key, value in POI_COLORS.items()}
POI_TEXT.update({"park": "#137333", "sports": "#137333", "stadium": "#137333", "cemetery": "#4e6b51",
                 "playground": "#137333", "campsite": "#137333", "restaurant": "#c5530a", "food": "#c5530a",
                 "cafe": "#c5530a", "bar": "#c5530a", "museum": "#0e8a9b", "theatre": "#0e8a9b",
                 "cinema": "#0e8a9b", "attraction": "#0e8a9b", "library": "#0e8a9b", "culture": "#0e8a9b",
                 "historic": "#0e8a9b"})
DEFAULT_POI = "#70757a"

# Traffic: same colours as the measured segments of GET /traffic/flow ("free" is also the colour of
# the roads without reported delays).
TRAFFIC = {"free": "#1e8e3e", "moderate": "#f9ab00", "slow": "#e8710a", "jammed": "#b31412"}
# Roads coloured when traffic is on, and their width (px) by zoom: a little narrower than the road
# so its edges stay visible; a class starts at its first zoom.
TRAFFIC_WIDTH = {
    "motorway": {5: 1.0, 8: 1.6, 10: 2.2, 12: 3.0, 14: 4.2, 16: 6.5, 18: 12},
    "trunk": {5: 0.9, 8: 1.5, 10: 2.0, 12: 2.8, 14: 4.0, 16: 6.0, 18: 11},
    "primary": {7: 0.8, 10: 1.6, 12: 2.4, 14: 3.6, 16: 5.5, 18: 10},
    "secondary": {10: 1.0, 12: 1.8, 14: 3.0, 16: 4.8, 18: 9},
    "tertiary": {13: 1.0, 14: 2.0, 16: 3.6, 18: 7},
}

# Relief: tint by elevation (m), from the coast to the snow of the volcanoes, under the hillshade.
RELIEF_TINT = [(-50, "#d5e8cf"), (0, "#dcebcb"), (250, "#e3edc8"), (700, "#eaeec8"), (1400, "#efeac6"),
               (2200, "#efe1c2"), (3000, "#e6d5bd"), (3700, "#dccfbf"), (4300, "#d9d4ce"), (4900, "#ebe9e6"),
               (5300, "#fbfbfb")]

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

    # Traffic: main roads in green ("sin demoras reportadas") while traffic is on; the measured
    # segments of GET /traffic/flow are drawn on top by the clients (maps-platform:traffic).
    traffic_classes = list(TRAFFIC_WIDTH)
    traffic_width = ["interpolate", ["exponential", 1.4], ["zoom"]]
    for zoom in sorted({zoom for stops in TRAFFIC_WIDTH.values() for zoom in stops}):
        match = ["match", get("class")]
        for cls in traffic_classes:
            match += [cls, round(_at(TRAFFIC_WIDTH[cls], zoom), 2)]
        traffic_width += [zoom, match + [0]]
    out.append({
        "id": "traffic-network", "type": "line", "source": SOURCE, "source-layer": "transportation", "minzoom": 5,
        "filter": ["all", ["in", get("class"), ["literal", traffic_classes]], ["!=", get("brunnel"), "tunnel"]],
        "layout": {"visibility": "none", "line-cap": "round", "line-join": "round", "line-sort-key": sort_key},
        "paint": {"line-color": TRAFFIC["free"], "line-width": traffic_width, "line-opacity": 0.85},
    })

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

    # Overlays: hidden by default, switched on by the clients ("Capas"). Their archive is only read
    # while one of them is visible, so the base map tiles stay light.
    precipitation = ["interpolate", ["linear"], ["coalesce", get("mm_max"), 0]]
    for value, color in PRECIPITATION:
        precipitation += [value, color]
    out += [
        {"id": "overlay-precipitation", "type": "fill", "source": OVERLAYS, "source-layer": "climate",
         "filter": ["==", get("class"), "precipitation"], "layout": {"visibility": "none"},
         "paint": {"fill-color": precipitation, "fill-opacity": 0.55, "fill-outline-color": "#ffffff"}},
        {"id": "overlay-temperature", "type": "fill", "source": OVERLAYS, "source-layer": "climate",
         "filter": ["==", get("class"), "temperature"], "layout": {"visibility": "none"},
         "paint": {"fill-color": ["match", get("band"), *sum(([band, color] for band, color in TEMPERATURE.items()), []),
                                  "#eeeeee"],
                   "fill-opacity": 0.55}},
        {"id": "overlay-population", "type": "heatmap", "source": OVERLAYS, "source-layer": "population",
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


def raster_attribution(kind: str) -> str:
    """Citation of the relief ("terrain") or imagery ("satellite") source of the data pipeline."""
    rasters = json.loads(SOURCES_CATALOG.read_text(encoding="utf-8")).get("rasters", {})
    citation = rasters.get(kind, {}).get("license", {}).get("citation")
    if not citation:
        raise ValueError(f"{SOURCES_CATALOG}: rasters.{kind}.license.citation is missing")
    return citation


def map_types(base_layers: list[dict]) -> dict:
    """Map types of the clients ("Mapa", "Satélite", "Relieve").

    A type other than the plain map reads one raster archive of the region (`asset`, the kind listed
    in GET /maps/regions) as `source`, inserts `layers` before the first layer whose template id is
    `before` (or the next one that exists), hides the layers of `hide` and overrides the paint
    properties of `paint` (by template layer id). `before` is not a style property: clients remove it.
    """
    ids = {layer["id"] for layer in base_layers}
    labels = [layer["id"] for layer in base_layers if layer["type"] == "symbol" and layer["id"] != "road-ref"]
    # Hybrid view: roads see-through over the imagery, white labels with a dark halo.
    satellite_paint = {layer_id: {"text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.75)",
                                  "text-halo-width": 1.4} for layer_id in labels}
    for layer_id in ("water-name", "waterway-label"):
        satellite_paint[layer_id]["text-color"] = "#cfe6ff"
    see_through = ["interpolate", ["linear"], ["zoom"], 6, 0.6, 12, 0.45, 16, 0.6]
    satellite_paint.update({
        "road": {"line-opacity": see_through},
        "road-bridge": {"line-opacity": see_through},
        "rail": {"line-opacity": 0.6},
        "boundary-other": {"line-color": "rgba(255,255,255,0.45)"},
        "boundary-state": {"line-color": "rgba(255,255,255,0.7)"},
        "boundary-country": {"line-color": "#ffffff"},
        "boundary-country-disputed": {"line-color": "#ffffff"},
    })
    tint = ["interpolate", ["linear"], ["elevation"]]
    for elevation, color in RELIEF_TINT:
        tint += [elevation, color]
    types = {
        "map": {"label": "Mapa"},
        "satellite": {
            "label": "Satélite",
            "asset": "satellite",
            "source": {"type": "raster", "tileSize": 512, "attribution": raster_attribution("satellite")},
            # Above land, water and buildings: where there is no imagery (outside the regions or over
            # the open sea, transparent) the plain map shows through.
            "layers": [{"id": "satellite", "type": "raster", "before": "road-path",
                        "paint": {"raster-fade-duration": 100}}],
            "hide": ["road-path", "road-tunnel", "road-casing", "road-bridge-casing"],
            "paint": satellite_paint,
        },
        "relief": {
            "label": "Relieve",
            "asset": "terrain",
            "source": {"type": "raster-dem", "encoding": "terrarium", "tileSize": 512,
                       "attribution": raster_attribution("terrain")},
            "layers": [
                # Tint under the land use (the natural cover is replaced by it), shading over it. The
                # elevation model includes trees and buildings: the shading fades out in the city.
                {"id": "relief-color", "type": "color-relief", "before": "landuse-urban",
                 "paint": {"color-relief-color": tint,
                           "color-relief-opacity": ["interpolate", ["linear"], ["zoom"], 5, 1, 12, 0.85, 15, 0.6]}},
                {"id": "hillshade", "type": "hillshade", "before": "road-path",
                 "paint": {"hillshade-method": "igor",
                           "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 10, 0.55, 13, 0.35,
                                                      15, 0.15, 17, 0],
                           "hillshade-shadow-color": "rgba(62,52,36,0.75)",
                           "hillshade-highlight-color": "rgba(255,255,255,0.3)",
                           "hillshade-illumination-direction": 315}},
            ],
            "hide": ["landuse-natural"],
            "paint": {},
        },
    }
    for spec in types.values():
        referenced = [layer["before"] for layer in spec.get("layers", [])]
        referenced += spec.get("hide", []) + list(spec.get("paint", {}))
        missing = [layer_id for layer_id in referenced if layer_id not in ids]
        if missing:
            raise ValueError(f"map type {spec['label']}: unknown layers {missing}")
    return types


def traffic() -> dict:
    """Traffic layers: the network turns visible, the measured segments come from GET /traffic/flow.

    The clients add a GeoJSON source with the flow of the visible area and `layers` (in order) before
    the first label layer. Segments of the "typical" source (usual traffic at this hour) are fainter.
    """
    status = ["match", get("status"), "moderate", TRAFFIC["moderate"], "slow", TRAFFIC["slow"],
              "jammed", TRAFFIC["jammed"], TRAFFIC["free"]]
    width = {11: 2.5, 14: 4.5, 17: 9}
    return {
        "colors": TRAFFIC,
        "network": ["traffic-network"],
        "layers": [
            {"id": "traffic-flow-casing", "type": "line", "layout": {"line-cap": "round", "line-join": "round"},
             "paint": {"line-color": "#ffffff", "line-opacity": 0.9,
                       "line-width": interpolate({zoom: value + 2 for zoom, value in width.items()}, 1.5)}},
            {"id": "traffic-flow", "type": "line", "layout": {"line-cap": "round", "line-join": "round"},
             "paint": {"line-color": status, "line-width": interpolate(width, 1.5),
                       "line-opacity": ["case", ["==", get("source"), "typical"], 0.75, 1]}},
        ],
    }


def style() -> dict:
    base_layers = layers()
    return {
        "version": 8,
        "name": "Maps Platform Light",
        "metadata": {
            "maps-platform:schema": "1.1.0",
            "maps-platform:overlays": {
                "precipitation": ["overlay-precipitation"],
                "temperature": ["overlay-temperature"],
                "population": ["overlay-population"],
            },
            "maps-platform:map-types": map_types(base_layers),
            "maps-platform:traffic": traffic(),
            "maps-platform:poi-colors": {**POI_COLORS, "default": DEFAULT_POI},
            "maps-platform:placeholders": {
                "__PMTILES_URL__": "PMTiles archive, e.g. https://host/maps/ecuador/ecuador.pmtiles or file:///...",
                "__OVERLAYS_URL__": "PMTiles archive of the overlays: the region's overlays asset, or the map "
                                    "archive itself for maps built before the overlays had their own",
                "__GLYPHS_URL__": "Base URL of the glyph folders, e.g. https://host/maps/fonts or file:///.../fonts",
            },
        },
        "sources": {
            SOURCE: {"type": "vector", "url": "pmtiles://__PMTILES_URL__", "attribution": ""},
            OVERLAYS: {"type": "vector", "url": "pmtiles://__OVERLAYS_URL__", "attribution": ""},
        },
        "glyphs": "__GLYPHS_URL__/{fontstack}/{range}.pbf",
        "layers": base_layers,
    }


def main() -> None:
    text = json.dumps(style(), ensure_ascii=False, indent=2) + "\n"
    for target in TARGETS:
        if target.parent.exists():
            target.write_text(text, encoding="utf-8", newline="\n")
            print(f"wrote {target}")


if __name__ == "__main__":
    main()
