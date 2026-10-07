"""National map layers and the search index, assembled from the cached official sources.

Writes into the region folder:

* map-places.geojson      label points of towns, neighbourhoods and localities
* map-pois.geojson        points of interest with a class, a subclass and a rank
* map-landuse.geojson     parks, sports grounds, cemeteries and squares
* map-urban.geojson       built-up areas (low zooms)
* map-blocks.geojson      city blocks (high zooms)
* map-buildings.geojson   building footprints (highest zooms)
* map-population.geojson  1 km population grid of the census (heat map)
* search.ndjson           every searchable name (places, streets, POIs) with its context
"""

from __future__ import annotations

import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable, Iterator

from . import geo, inec
from .text import Speller, clean, fold, normalize_kind, street_aliases, street_label, title


def log(message: str) -> None:
    print(f"[catalog] {message}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------- helpers


class FeatureWriter:
    """Streams a GeoJSON FeatureCollection with one feature per line."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.temporary = path.with_name(f".{path.name}.part")
        self.handle = self.temporary.open("w", encoding="utf-8", newline="\n")
        self.handle.write('{"type":"FeatureCollection","features":[\n')
        self.count = 0

    def write(self, geometry: dict[str, Any], properties: dict[str, Any]) -> None:
        feature = {"type": "Feature", "properties": properties, "geometry": geometry}
        self.handle.write(("," if self.count else "") + json.dumps(feature, ensure_ascii=False, separators=(",", ":")) + "\n")
        self.count += 1

    def close(self) -> int:
        self.handle.write("]}\n")
        self.handle.close()
        self.temporary.replace(self.path)
        return self.count


def read_collection(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as handle:
        return json.load(handle).get("features") or []


def polygons_of(geometry: dict[str, Any]) -> list[list[list[tuple[float, float]]]]:
    return _polygons(geometry)


def _polygons(geometry: dict[str, Any]) -> list[list[list[tuple[float, float]]]]:
    if not geometry:
        return []
    kind, coordinates = geometry.get("type"), geometry.get("coordinates") or []
    raw = [coordinates] if kind == "Polygon" else coordinates if kind == "MultiPolygon" else []
    return [[[(p[0], p[1]) for p in ring] for ring in polygon if len(ring) >= 4] for polygon in raw if polygon]


def _all_points(polygons) -> Iterator[tuple[float, float]]:
    for polygon in polygons:
        for ring in polygon:
            yield from ring


def _round(value: float, digits: int = 6) -> float:
    return round(value, digits)


# ---------------------------------------------------------------- administrative units


class Admin:
    """Names of provinces, cantons and parishes by DPA code, and point lookups."""

    def __init__(self, destination: Path, speller: Speller) -> None:
        self.parish: dict[str, dict[str, str]] = {}
        self.canton: dict[str, str] = {}
        self.province: dict[str, str] = {}
        self.units: list[dict[str, Any]] = []
        self._grid: dict[tuple[int, int], list[int]] = defaultdict(list)
        self._shapes: list[tuple[str, list, list[float]]] = []
        for layer, level, code_field, name_field in (
            ("boundary-province", "province", "dpa_provin", "dpa_despro"),
            ("boundary-canton", "canton", "dpa_canton", "dpa_descan"),
            ("boundary-parish", "parish", "dpa_parroq", "dpa_despar"),
        ):
            for feature in read_collection(destination / f"{layer}.geojson"):
                props = feature.get("properties") or {}
                code = clean(props.get(code_field))
                name = clean(props.get(name_field))
                if not code or not name:
                    continue
                speller.learn(name)
                polygons = _polygons(feature.get("geometry") or {})
                if not polygons:
                    continue
                point = geo.representative_point(polygons)
                box = geo.bbox(_all_points(polygons))
                self.units.append({"level": level, "code": code, "raw": name, "point": point, "bbox": box,
                                   "province": clean(props.get("dpa_despro")), "canton": clean(props.get("dpa_descan"))})
                if level == "parish":
                    index = len(self._shapes)
                    self._shapes.append((code, polygons, box))
                    for cx in range(int(box[0] * 20), int(box[2] * 20) + 1):
                        for cy in range(int(box[1] * 20), int(box[3] * 20) + 1):
                            self._grid[(cx, cy)].append(index)

    def finish(self, speller: Speller) -> None:
        for unit in self.units:
            unit["name"] = display_admin(title(unit["raw"], speller))
            if unit["level"] == "province":
                self.province[unit["code"]] = unit["name"]
        for unit in self.units:
            if unit["level"] == "canton":
                self.canton[unit["code"]] = unit["name"]
        for unit in self.units:
            if unit["level"] == "parish":
                code = unit["code"]
                self.parish[code] = {
                    "parish": unit["name"],
                    "canton": self.canton.get(code[:4], ""),
                    "province": self.province.get(code[:2], ""),
                }

    def context(self, parish_code: str | None) -> dict[str, str]:
        if not parish_code:
            return {}
        info = self.parish.get(parish_code[:6])
        if info:
            return info
        return {"canton": self.canton.get(parish_code[:4], ""), "province": self.province.get(parish_code[:2], "")}

    def locate(self, lon: float, lat: float) -> str | None:
        for index in self._grid.get((int(lon * 20), int(lat * 20)), ()):
            code, polygons, box = self._shapes[index]
            if box[0] <= lon <= box[2] and box[1] <= lat <= box[3]:
                if any(geo.point_in_polygon(lon, lat, polygon) for polygon in polygons):
                    return code
        return None


def display_admin(name: str | None) -> str:
    if not name:
        return ""
    return re.sub(r"^Distrito Metropolitano de ", "", name)


def context_line(info: dict[str, str], locality: str | None = None) -> str:
    """"Tarqui, Cuenca, Azuay" without repeated names."""
    parts: list[str] = []
    for value in (locality, info.get("parish"), info.get("canton"), info.get("province")):
        if value and fold(value) not in {fold(part) for part in parts}:
            parts.append(value)
    return ", ".join(parts)


# ---------------------------------------------------------------- POI classification

_POI_RULES: list[tuple[str, str, str, int]] = [
    (r"\bAEROPUERTO\b", "airport", "airport", 4),
    (r"\bTERMINAL TERRESTRE\b|\bTERMINAL (INTER)?PROVINCIAL\b|\bTERMINAL DE (BUSES|OMNIBUS|TRANSPORTE)\b", "bus", "bus_station", 6),
    (r"\bTERMINAL\b.*\b(METROVIA|TROLE|ECOVIA|METROBUS)\b|\bESTACION\b.*\b(METROVIA|TROLE|ECOVIA|METRO)\b", "bus", "bus_stop", 14),
    (r"\bESTACION\b.*\b(TREN|FERROCARRIL|FERREA)\b", "rail", "station", 12),
    (r"\bCENTRO COMERCIAL\b|\bMALL\b|\bSHOPPING\b|\bRIOCENTRO\b|\bQUICENTRO\b|\bSAN MARINO\b|\bPASEO SHOPPING\b|\bPLAZA COMERCIAL\b", "shop", "mall", 8),
    (r"\bSUPERMAXI\b|\bMEGAMAXI\b|\bSUPERMERCADO\b|\bHIPERMARKET\b|\bMI COMISARIATO\b|\bGRAN AKI\b|\bAKI\b|\bALMACENES TIA\b|\bTIA\b|\bSANTA MARIA\b.*\bSUPER", "shop", "supermarket", 14),
    (r"\bMERCADO\b", "shop", "marketplace", 12),
    (r"\bHOSPITAL\b", "hospital", "hospital", 8),
    (r"\bCLINICA\b|\bSUBCENTRO\b|\bCENTRO DE SALUD\b|\bDISPENSARIO\b|\bPUESTO DE SALUD\b|\bCENTRO MEDICO\b", "hospital", "clinic", 16),
    (r"\bFARMACIA\b|\bBOTICA\b|\bFYBECA\b|\bSANASANA\b|\bPHARMACY\b", "pharmacy", "pharmacy", 20),
    (r"\bUNIVERSIDAD\b|\bESCUELA POLITECNICA\b|\bESPOL\b|\bESPE\b|\bINSTITUTO (TECNOLOGICO|SUPERIOR)\b", "college", "university", 10),
    (r"\bUNIDAD EDUCATIVA\b|\bESCUELA\b|\bCOLEGIO\b|\bJARDIN DE INFANTES\b|\bCENTRO EDUCATIVO\b|\bCENTRO INFANTIL\b|\bCIBV\b|\bCDI\b|\bGUARDERIA\b|\bLICEO\b|\bACADEMIA\b", "school", "school", 18),
    (r"\bESTADIO\b", "stadium", "stadium", 10),
    (r"\bCOLISEO\b|\bPOLIDEPORTIVO\b|\bCOMPLEJO DEPORTIVO\b|\bPISCINA\b|\bGIMNASIO\b", "sports", "sports_centre", 16),
    (r"\bCANCHA\b", "sports", "pitch", 22),
    (r"\bMUSEO\b", "museum", "museum", 12),
    (r"\bBIBLIOTECA\b", "library", "library", 16),
    (r"\bTEATRO\b|\bCASA DE LA CULTURA\b|\bCENTRO CULTURAL\b", "theatre", "theatre", 14),
    (r"\bCINE\b|\bCINEMA\b|\bSUPERCINES\b|\bMULTICINES\b|\bCINEMARK\b", "cinema", "cinema", 16),
    (r"\bHOTEL\b|\bHOSTAL\b|\bHOSTERIA\b|\bHOSPEDAJE\b|\bRESIDENCIAL\b|\bLODGE\b|\bMOTEL\b", "lodging", "hotel", 18),
    (r"\bRESTAURANTE?\b|\bCHIFA\b|\bMARISQUERIA\b|\bPICANTERIA\b|\bPARRILLADA\b|\bASADERO\b|\bPOLLO\b|\bPIZZERIA\b|\bCAFETERIA\b|\bCEVICHERIA\b|\bCOMEDOR\b|\bKFC\b|\bMC ?DONALDS\b|\bBURGER\b|\bCAFE\b", "restaurant", "restaurant", 20),
    (r"\bBANCO\b|\bCOOPERATIVA DE AHORRO\b|\bCAJERO\b|\bMUTUALISTA\b|\bBANECUADOR\b", "bank", "bank", 18),
    (r"\bUPC\b|\bUVC\b|\bPOLICIA\b|\bCOMANDO\b.*\bPOLICIA|\bUNIDAD DE VIGILANCIA\b|\bRETEN\b|\bDINAPEN\b|\bGEMA\b|\bUPC\d", "police", "police", 16),
    (r"\bBOMBEROS?\b", "fire_station", "fire_station", 16),
    (r"\bMUNICIPIO\b|\bALCALDIA\b|\bMUNICIPALIDAD\b|\bGAD\b|\bGOBIERNO AUTONOMO\b|\bGOBERNACION\b|\bPREFECTURA\b|\bCONSEJO PROVINCIAL\b|\bTENENCIA POLITICA\b|\bJUNTA PARROQUIAL\b|\bPALACIO MUNICIPAL\b", "town_hall", "town_hall", 12),
    (r"\bMINISTERIO\b|\bREGISTRO CIVIL\b|\bSRI\b|\bFISCALIA\b|\bJUDICATURA\b|\bUNIDAD JUDICIAL\b|\bCORTE\b|\bCNE\b|\bAGENCIA NACIONAL DE TRANSITO\b|\bANT\b|\bIESS\b|\bECU ?911\b|\bSECRETARIA\b|\bDEFENSORIA\b|\bCONTRALORIA\b|\bASAMBLEA\b|\bCARONDELET\b", "government", "government", 16),
    (r"\bCEMENTERIO\b|\bCAMPOSANTO\b|\bJARDINES DEL\b", "cemetery", "cemetery", 18),
    (r"\bGASOLINERA\b|\bESTACION DE SERVICIO\b|\bPETROECUADOR\b.*\bSERVICIO|\bPRIMAX\b|\bTERPEL\b|\bMOBIL\b", "fuel", "fuel", 18),
    (r"\bCORREOS?\b", "post", "post_office", 20),
    (r"\bFUERTE MILITAR\b|\bCUARTEL\b|\bBATALLON\b|\bBASE NAVAL\b|\bBASE AEREA\b|\bBRIGADA\b|\bDESTACAMENTO\b|\bCOMANDO CONJUNTO\b", "military", "military", 16),
    (r"\bMUELLE\b|\bEMBARCADERO\b|\bPUERTO\b(?!.*\bCAMARONERA)", "ferry", "ferry_terminal", 14),
    (r"\bIGLESIA\b|\bCAPILLA\b|\bTEMPLO\b|\bCATEDRAL\b|\bBASILICA\b|\bSANTUARIO\b|\bMEZQUITA\b|\bSINAGOGA\b|\bSALON DEL REINO\b|\bCONVENTO\b|\bMONASTERIO\b|\bPARROQUIA ECLESIASTICA\b|\bMISION\b", "place_of_worship", "place_of_worship", 18),
    (r"\bPARQUE\b|\bJARDIN BOTANICO\b|\bBOSQUE PROTECTOR\b", "park", "park", 14),
    (r"\bMALECON\b", "park", "promenade", 10),
    (r"\bPLAZA\b|\bPLAZOLETA\b", "park", "square", 16),
    (r"\bMONUMENTO\b|\bMIRADOR\b|\bFARO\b|\bHEMICICLO\b|\bTORRE\b", "attraction", "viewpoint", 14),
    (r"\bCASA COMUNAL\b|\bSALON COMUNAL\b|\bCENTRO COMUNITARIO\b|\bSEDE SOCIAL\b", "community", "community_centre", 22),
]
_POI_PATTERNS = [(re.compile(pattern), cls, subclass, rank) for pattern, cls, subclass, rank in _POI_RULES]
_CATEGORY_FALLBACK = {
    "TEMPLO RELIGIOSO": ("place_of_worship", "place_of_worship", 20),
    "EDIFICIO EDUCACIONAL": ("school", "school", 20),
    "ESTABLECIMIENTO DE SALUD": ("hospital", "clinic", 18),
    "CAMPO DEPORTIVO": ("sports", "pitch", 22),
    "PARQUE": ("park", "park", 18),
    "CEMENTERIO": ("cemetery", "cemetery", 20),
    "GASOLINERA": ("fuel", "fuel", 18),
    "PLAZA": ("park", "square", 18),
    "CASA COMUNAL": ("community", "community_centre", 22),
    "EDIFICIO IMPORTANTE": ("building", "landmark", 18),
    "EDIFICIO DE REFERENCIA": ("building", "reference", 22),
}
_CATEGORY_LABEL = {
    "park": "Parque", "fuel": "Gasolinera", "cemetery": "Cementerio", "square": "Plaza",
}


def classify_poi(name: str | None, category: str | None) -> tuple[str, str, int]:
    text = fold(name).upper() if name else ""
    for pattern, cls, subclass, rank in _POI_PATTERNS:
        if text and pattern.search(text):
            return cls, subclass, rank
    return _CATEGORY_FALLBACK.get(category or "", ("building", "landmark", 24))


SUBCLASS_LABELS = {
    "airport": "Aeropuerto", "bus_station": "Terminal de buses", "bus_stop": "Parada de bus", "station": "Estación",
    "mall": "Centro comercial", "supermarket": "Supermercado", "marketplace": "Mercado", "hospital": "Hospital",
    "clinic": "Centro de salud", "pharmacy": "Farmacia", "university": "Universidad", "school": "Institución educativa",
    "stadium": "Estadio", "sports_centre": "Centro deportivo", "pitch": "Cancha", "museum": "Museo",
    "library": "Biblioteca", "theatre": "Teatro y cultura", "cinema": "Cine", "hotel": "Alojamiento",
    "restaurant": "Restaurante", "bank": "Banco", "police": "Policía", "fire_station": "Bomberos",
    "town_hall": "Gobierno local", "government": "Oficina pública", "cemetery": "Cementerio", "fuel": "Gasolinera",
    "post_office": "Correo", "military": "Instalación militar", "ferry_terminal": "Muelle",
    "place_of_worship": "Templo", "park": "Parque", "promenade": "Malecón", "square": "Plaza",
    "viewpoint": "Lugar de interés", "community_centre": "Casa comunal", "landmark": "Edificio de referencia",
    "reference": "Lugar", "attraction": "Atractivo turístico", "health_lab": "Laboratorio clínico",
    "doctor": "Consultorio",
}

# ---------------------------------------------------------------- health, schools, tourism

_HEALTH_SKIP = re.compile(r"AMBULANCIA|UNIDAD MOVIL|VEHICULO|TRANSPORTE PRIMARIO|ATENCION DOMICILIARIA|^-$")


def health_poi(props: dict[str, Any]) -> tuple[str, str, int, str] | None:
    typology = (clean(props.get("tipología") or props.get("tipologia") or props.get("tipolog�a")) or "").upper()
    if _HEALTH_SKIP.search(fold(typology).upper()):
        return None
    state = (clean(props.get("estado")) or "ACTIVADO").upper()
    if state not in {"ACTIVADO", "ACTIVO", "HABILITADO"}:
        return None
    folded = fold(typology)
    if "hospital" in folded:
        return "hospital", "hospital", 8, "Hospital"
    if "centro de salud" in folded or "puesto de salud" in folded or "centro de especialidades" in folded:
        return "hospital", "clinic", 14, "Centro de salud" if "puesto" not in folded else "Puesto de salud"
    if "laboratorio" in folded or "radiologia" in folded or "diagnostico" in folded or "banco de sangre" in folded:
        return "hospital", "health_lab", 24, "Laboratorio"
    if "consultorio" in folded or "optometria" in folded or "podologia" in folded:
        return "hospital", "doctor", 26, "Consultorio"
    return "hospital", "clinic", 20, "Centro de salud"


def with_prefix(name: str, prefix: str) -> str:
    if fold(name).startswith(fold(prefix).split(" ")[0]):
        return name
    return f"{prefix} {name}"


# ---------------------------------------------------------------- assembly


def assemble(destination: Path, speller: Speller, admin: Admin, aliases: list[dict[str, Any]],
             include_buildings: bool = True) -> dict[str, Any]:
    report: dict[str, Any] = {}
    search = SearchWriter(destination / "search.ndjson")

    # Administrative units.
    for unit in admin.units:
        level = unit["level"]
        rank = {"province": 90, "canton": 76, "parish": 58}[level]
        info = {"province": admin.province.get(unit["code"][:2], "")}
        if level == "parish":
            info["canton"] = admin.canton.get(unit["code"][:4], "")
        if level == "canton":
            detail = context_line({"province": info["province"]})
        elif level == "parish":
            detail = context_line({"canton": info["canton"], "province": info["province"]})
        else:
            detail = "Ecuador"
        search.add(name=unit["name"], kind="admin", type={"province": "state", "canton": "county",
                                                          "parish": "administrative"}[level],
                   point=unit["point"], detail=detail, rank=rank, bbox=unit["bbox"], parish=unit["code"])

    # Built-up areas, with their census population.
    population = list(inec.features(destination, "population"))
    urban = FeatureWriter(destination / "map-urban.geojson")
    places = FeatureWriter(destination / "map-places.geojson")
    areas = []
    for feature in inec.features(destination, "areas"):
        props = feature["properties"]
        name = title(clean(props.get("n")), speller)
        polygons = _polygons(feature.get("geometry") or {})
        if not name or not polygons:
            continue
        areas.append((name, props, polygons, geo.bbox(_all_points(polygons))))
    people = _population_by_area(areas, population)
    capital_parishes = {"170150"}
    for index, (name, props, polygons, box) in enumerate(areas):
        kind = (clean(props.get("t")) or "").upper()
        parish = clean(props.get("p"))
        point = geo.representative_point(polygons)
        inhabitants = people.get(index, 0)
        if kind == "CAPITAL PROVINCIAL":
            cls, rank, place_rank = "city", 88, 1 if inhabitants > 1_000_000 else 2
        elif kind == "CABECERA CANTONAL":
            cls, rank, place_rank = "town", 80, 3
        elif kind == "CABECERA PARROQUIAL":
            cls, rank, place_rank = "village", 66, 4
        else:
            cls, rank, place_rank = "hamlet", 56, 5
        if inhabitants >= 200_000:
            rank += 6
        props_out: dict[str, Any] = {"class": cls, "rank": place_rank, "name": name}
        if inhabitants:
            props_out["population"] = inhabitants
        if parish in capital_parishes and cls == "city":
            props_out["capital"] = 2
        elif cls == "city":
            props_out["capital"] = 4
        places.write({"type": "Point", "coordinates": [_round(point[0]), _round(point[1])]}, props_out)
        urban.write({"type": "MultiPolygon", "coordinates": [[[list(p) for p in ring] for ring in polygon]
                                                               for polygon in polygons]},
                    {"class": "residential", "name": name})
        info = admin.context(parish)
        search.add(name=name, kind="place", type=cls, point=point, bbox=box, rank=rank,
                   detail=context_line({"canton": info.get("canton"), "province": info.get("province")}, None)
                   if fold(info.get("canton")) != fold(name) else info.get("province", ""),
                   parish=parish, population=inhabitants)
    report["urban_areas"] = urban.close()

    # Localities of the rural census sectors.
    seen_localities: set[tuple[str, int, int]] = set()
    for feature in inec.features(destination, "localities"):
        props = feature["properties"]
        name = title(clean(props.get("n")), speller)
        if not name:
            continue
        lon, lat = feature["geometry"]["coordinates"]
        key = (fold(name), int(lon * 200), int(lat * 200))  # same name within ~500 m: one entry
        if key in seen_localities:
            continue
        seen_localities.add(key)
        code = clean(props.get("c"))
        main = clean(props.get("pr")) == "1"
        places.write({"type": "Point", "coordinates": [lon, lat]},
                     {"class": "hamlet" if main else "locality", "rank": 6 if main else 7, "name": name})
        parish = code[:6] if code and len(code) >= 6 else admin.locate(lon, lat)
        search.add(name=name, kind="place", type="hamlet" if main else "locality", point=(lon, lat),
                   rank=46 if main else 40, detail=context_line(admin.context(parish)), parish=parish)

    # Neighbourhoods published by municipalities (optional layers of the catalog).
    for layer, name_fields in (("neighborhoods-guayaquil", ("Coop", "coop", "nombre", "name")),
                               ("neighborhoods-quito", ("nombre_par", "nom_barrio", "barrio", "nombre"))):
        for feature in read_collection(destination / f"{layer}.geojson"):
            props = feature.get("properties") or {}
            raw = next((clean(props.get(field)) for field in name_fields if clean(props.get(field))), None)
            name = title(raw, speller)
            polygons = _polygons(feature.get("geometry") or {})
            if not name or not polygons:
                continue
            point = geo.representative_point(polygons)
            places.write({"type": "Point", "coordinates": [_round(point[0]), _round(point[1])]},
                         {"class": "suburb", "rank": 5, "name": name})
            parish = admin.locate(*point)
            search.add(name=name, kind="place", type="suburb", point=point, bbox=geo.bbox(_all_points(polygons)),
                       rank=62, detail=context_line(admin.context(parish)), parish=parish)
    report["places"] = places.close()

    # Points of interest: census landmarks, health, schools, tourism.
    pois = FeatureWriter(destination / "map-pois.geojson")
    seen_pois: dict[tuple[str, int, int], bool] = {}

    def add_poi(name: str | None, point, cls: str, subclass: str, rank: int, parish: str | None,
                address: str | None = None, generic: bool = False) -> None:
        if not name:
            return
        key = (fold(name), int(point[0] * 1000), int(point[1] * 1000))  # ~110 m
        if key in seen_pois:
            return
        seen_pois[key] = True
        props: dict[str, Any] = {"class": cls, "subclass": subclass, "rank": rank}
        if not generic:
            props["name"] = name  # unnamed parks or fuel stations only get their icon on the map
        pois.write({"type": "Point", "coordinates": [_round(point[0]), _round(point[1])]}, props)
        info = admin.context(parish)
        label = SUBCLASS_LABELS.get(subclass, "Lugar")
        detail = " · ".join(part for part in (label if not generic else "", address, context_line(info)) if part)
        search.add(name=name, kind="poi", type=subclass, category=cls, point=point,
                   rank=24 if generic else max(26, 72 - rank), detail=detail, parish=parish)

    for feature in inec.features(destination, "landmarks"):
        props = feature["properties"]
        category = clean(props.get("c"))
        raw = clean(props.get("n"))
        cls, subclass, rank = classify_poi(raw, category)
        if not raw and subclass not in _CATEGORY_LABEL:
            continue
        name = title(raw, speller) if raw else _CATEGORY_LABEL[subclass]
        block = clean(props.get("m"))
        point = feature["geometry"]["coordinates"]
        parish = block[:6] if block and len(block) >= 6 else admin.locate(point[0], point[1])
        add_poi(name, point, cls, subclass, rank + (6 if not raw else 0), parish, generic=not raw)

    for feature in read_collection(destination / "poi-health.geojson"):
        props = feature.get("properties") or {}
        kind = health_poi(props)
        raw = clean(props.get("uni_nombre__nombre_oficial_") or props.get("uni_nombre"))
        geometry = feature.get("geometry") or {}
        if not kind or not raw or geometry.get("type") != "Point":
            continue
        cls, subclass, rank, prefix = kind
        name = with_prefix(title(raw, speller), prefix) if subclass in {"hospital", "clinic"} else title(raw, speller)
        parish = clean(props.get("par_codigo")) or clean(props.get("dpa_parroq"))
        address = title(clean(props.get("uni_direccion")), speller)
        add_poi(name, geometry["coordinates"], cls, subclass, rank, parish, address if address and len(address) < 80 else None)

    for feature in read_collection(destination / "poi-education.geojson"):
        props = feature.get("properties") or {}
        raw = clean(props.get("nom_instit"))
        geometry = feature.get("geometry") or {}
        if not raw or geometry.get("type") != "Point":
            continue
        cls, subclass, rank = classify_poi(raw, "EDIFICIO EDUCACIONAL")
        if cls not in {"school", "college"}:
            cls, subclass, rank = "school", "school", 18
        point = geometry["coordinates"]
        add_poi(title(raw, speller), point, cls, subclass, rank, admin.locate(*point))

    for feature in read_collection(destination / "poi-tourism.geojson"):
        props = feature.get("properties") or {}
        raw = clean(props.get("nombre") or props.get("nam") or props.get("na2"))
        geometry = feature.get("geometry") or {}
        if not raw or geometry.get("type") != "Point":
            continue
        cls, subclass, rank = classify_poi(raw, None)
        if cls in {"building"}:
            cls, subclass, rank = "attraction", "attraction", 14
        point = geometry["coordinates"]
        add_poi(title(raw, speller), point, cls, subclass, rank, clean(props.get("dpa_parroq")) or admin.locate(*point))
    report["pois"] = pois.close()

    # Streets: one search entry per name and parish (with intersections resolved by the backend).
    streets: dict[tuple[str, str], dict[str, Any]] = {}
    for feature in inec.features(destination, "streets"):
        props = feature["properties"]
        kind = normalize_kind(props.get("k"))
        raw = clean(props.get("n"))
        if not raw or kind == "LINEA FERREA":
            continue
        parish = clean(props.get("p")) or ""
        label = street_label(kind, raw, speller)
        if not label:
            continue
        coordinates = feature["geometry"]["coordinates"]
        length = geo.line_length([tuple(p) for p in coordinates])
        entry = streets.setdefault((label, parish), {"kind": kind, "length": 0.0, "points": [], "box": None,
                                                     "aliases": set(street_aliases(raw))})
        entry["length"] += length
        middle = coordinates[len(coordinates) // 2]
        entry["points"].append((middle[0], middle[1], length))
        box = geo.bbox(coordinates)
        entry["box"] = box if entry["box"] is None else [min(entry["box"][0], box[0]), min(entry["box"][1], box[1]),
                                                         max(entry["box"][2], box[2]), max(entry["box"][3], box[3])]
    for (label, parish), entry in streets.items():
        # The segment middle closest to the length-weighted centre is the street's point.
        total = sum(weight for *_, weight in entry["points"]) or 1
        cx = sum(x * w for x, _, w in entry["points"]) / total
        cy = sum(y * w for _, y, w in entry["points"]) / total
        point = min(entry["points"], key=lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2)[:2]
        kind = entry["kind"]
        rank = 58 if kind in {"AUTOPISTA", "PANAMERICANA", "CARRETERA", "CIRCUNVALACION", "VIA"} else \
            54 if kind == "AVENIDA" else 44 if kind in {"CALLE", "TRANSVERSAL", "DIAGONAL", None} else 34
        rank += min(6, int(entry["length"] // 1000))
        road_aliases = [title(alias, speller) for alias in entry["aliases"]]
        search.add(name=label, kind="street", type=(kind or "CALLE").lower(), point=point, bbox=entry["box"],
                   rank=rank, detail=context_line(admin.context(parish)), parish=parish or None,
                   aliases=[alias for alias in road_aliases if alias])
    report["streets"] = len(streets)


    # Land use, blocks, buildings, population.
    landuse = FeatureWriter(destination / "map-landuse.geojson")
    for feature in inec.features(destination, "landuse"):
        props = feature["properties"]
        category = clean(props.get("c"))
        cls = {"PARQUE": "park", "CAMPO DEPORTIVO": "pitch", "CEMENTERIO": "cemetery", "PLAZA": "square"}.get(category or "")
        if not cls:
            continue
        out = {"class": cls}
        name = title(clean(props.get("n")), speller)
        if name:
            out["name"] = name
        landuse.write(feature["geometry"], out)
    report["landuse"] = landuse.close()

    blocks = FeatureWriter(destination / "map-blocks.geojson")
    for feature in inec.features(destination, "blocks"):
        blocks.write(feature["geometry"], {"class": "block"})
    report["blocks"] = blocks.close()

    buildings = FeatureWriter(destination / "map-buildings.geojson")
    if include_buildings:
        for feature in inec.features(destination, "buildings"):
            buildings.write(feature["geometry"], {})
    report["buildings"] = buildings.close()

    grid = FeatureWriter(destination / "map-population.geojson")
    for feature in population:
        props = feature["properties"]
        grid.write(feature["geometry"], {"pop": props.get("pop", 0), "homes": props.get("viv", 0)})
    report["population_cells"] = grid.close()

    report["search_entries"] = search.close()
    report["neighbourhood_groups"] = add_neighbourhood_groups(destination / "search.ndjson")
    report["aliases"] = add_aliases(destination / "search.ndjson", aliases)
    return report


_NEIGHBOURHOOD_PREFIX = re.compile(r"^(?:cdla\.?|ciudadela|urb\.?|urbanizaci[oó]n|coop\.?|cooperativa)\s+", re.I)
_NEIGHBOURHOOD_STAGE = re.compile(
    r"\s*[-/,]?\s*\b(?:\d+(?:-?[a-z])?|[ivxl]+)(?:\s*-\s*(?:\d+|[ivxl]+))?\s*(?:ra|da|ta|er|era|a|°|º)?\.?\s+etapa\b.*$"
    r"|\s*[-/,]?\s*\betapa\s+(?:\d+|[ivxl]+)\b.*$",
    re.I)
_NEIGHBOURHOOD_SECTOR = re.compile(r"\s*[-/,]\s*(?:sector|zona|bloque)\b.*$|\s+(?:sector|zona|bloque)\s+\S+$", re.I)
_NEIGHBOURHOOD_SIDE = re.compile(r"\s+(?:central|norte|sur|este|oeste)$", re.I)


def neighbourhood_families(name: str) -> list[str]:
    """Names of the wider neighbourhood a stage belongs to, as people say them.

    "Alborada IX Etapa" -> ["Alborada"]; "Urb. Kennedy Norte - I Etapa / Sector A" -> ["Kennedy Norte",
    "Kennedy"]; "Urdesa Central" -> ["Urdesa"]. Municipal layers list every stage or sector apart, so
    nobody finds "Alborada" or "Urdesa" without these groups.
    """
    families = []
    base = _NEIGHBOURHOOD_PREFIX.sub("", name.strip())
    base = _NEIGHBOURHOOD_STAGE.sub("", base)
    base = _NEIGHBOURHOOD_SECTOR.sub("", base)
    base = re.sub(r"\s*[-/,]\s*$", "", base).strip()
    for candidate in (base, _NEIGHBOURHOOD_SIDE.sub("", base).strip()):
        candidate = candidate[:1].upper() + candidate[1:]  # "Urb los Samanes" -> "Los Samanes"
        if len(fold(candidate)) >= 4 and fold(candidate) != fold(name) and candidate not in families:
            families.append(candidate)
    return families


def add_neighbourhood_groups(path: Path) -> int:
    """Adds one search entry per neighbourhood made of several stages or sectors of the same canton
    ("Alborada" for its twelve stages), unless a place of that name already exists there. The entry
    covers the union of its members and points at the member nearest to the centre. Idempotent;
    returns how many groups the index has."""
    lines = path.read_text(encoding="utf-8").splitlines()
    entries = [json.loads(line) for line in lines]
    existing: dict[tuple[str, str], list[tuple[float, float]]] = defaultdict(list)
    for e in entries:
        if e["k"] in ("place", "admin"):
            existing[(fold(e["n"]), (e.get("p") or "")[:4])].append((e["x"], e["y"]))
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    for entry in entries:
        if entry["k"] != "place" or entry.get("t") != "suburb" or entry.get("group"):
            continue
        for family in neighbourhood_families(entry["n"]):
            key = (fold(family), (entry.get("p") or "")[:4])
            group = groups.setdefault(key, {"name": family, "members": []})
            group["members"].append(entry)
    added = 0
    for key, group in sorted(groups.items()):
        members = group["members"]
        if len(members) < 2:
            continue
        boxes = [m.get("b") or [m["x"], m["y"], m["x"], m["y"]] for m in members]
        box = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
        # A place of that name already there is the same neighbourhood (a namesake hamlet elsewhere
        # in the canton, like Los Samanes of Puná, is not).
        if any(box[0] - 0.01 <= x <= box[2] + 0.01 and box[1] - 0.01 <= y <= box[3] + 0.01
               for x, y in existing.get(key, ())):
            continue
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        anchor = min(members, key=lambda m: (m["x"] - cx) ** 2 + (m["y"] - cy) ** 2)
        entry = {"n": group["name"], "k": "place", "t": "suburb", "x": anchor["x"], "y": anchor["y"],
                 "r": max(m["r"] for m in members) + 2, "d": anchor.get("d", ""), "b": [round(v, 5) for v in box],
                 "p": anchor.get("p"), "group": len(members)}
        lines.append(json.dumps({k: v for k, v in entry.items() if v is not None}, ensure_ascii=False,
                                separators=(",", ":")))
        existing[key].append((entry["x"], entry["y"]))
        added += 1
    if added:
        temporary = path.with_name(f".{path.name}.part")
        temporary.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
        temporary.replace(path)
    total = added + sum(1 for entry in entries if entry.get("group"))
    log(f"{total} neighbourhoods grouped from their stages ({added} new)")
    return total


def add_aliases(path: Path, aliases: list[dict[str, Any]]) -> dict[str, int]:
    """Popular names ("Malecón 2000") become extra names of the official entry they refer to.

    Each alias names its target by words of the official name, the entry kind and the parish
    code prefix; the best ranked match wins. Unresolved aliases are reported, never guessed.
    """
    if not aliases:
        return {"resolved": 0, "unresolved": 0}
    targets = []
    for alias in aliases:
        target = alias["target"]
        targets.append((alias, fold(target["name"]).split(), target.get("kind"), target.get("parish", "")))
    best: dict[int, tuple[int, int]] = {}
    lines = path.read_text(encoding="utf-8").splitlines()
    for number, line in enumerate(lines):
        entry = json.loads(line)
        words = set(fold(entry["n"]).split()) | {w for a in entry.get("a", []) for w in fold(a).split()}
        for index, (_, needed, kind, parish) in enumerate(targets):
            if kind and entry["k"] != kind:
                continue
            if parish and not (entry.get("p") or "").startswith(parish):
                continue
            if all(word in words for word in needed):
                if index not in best or entry["r"] > best[index][0]:
                    best[index] = (entry["r"], number)
    for index, (alias, *_rest) in enumerate(targets):
        if index not in best:
            log(f"alias not resolved: {alias['names']} -> {alias['target']}")
            continue
        number = best[index][1]
        entry = json.loads(lines[number])
        entry["a"] = sorted(set(entry.get("a", [])) | set(alias["names"]))
        entry["r"] = max(entry["r"], alias.get("rank", entry["r"]))
        lines[number] = json.dumps(entry, ensure_ascii=False, separators=(",", ":"))
    temporary = path.with_name(f".{path.name}.part")
    temporary.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    temporary.replace(path)
    return {"resolved": len(best), "unresolved": len(targets) - len(best)}


def _population_by_area(areas, population) -> dict[int, int]:
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for index, (_, _, _, box) in enumerate(areas):
        for cx in range(int(box[0] * 50), int(box[2] * 50) + 1):
            for cy in range(int(box[1] * 50), int(box[3] * 50) + 1):
                grid[(cx, cy)].append(index)
    totals: dict[int, int] = defaultdict(int)
    for feature in population:
        lon, lat = feature["geometry"]["coordinates"]
        people = int(feature["properties"].get("pop") or 0)
        for index in grid.get((int(lon * 50), int(lat * 50)), ()):
            _, _, polygons, box = areas[index]
            if box[0] <= lon <= box[2] and box[1] <= lat <= box[3] and any(
                    geo.point_in_polygon(lon, lat, polygon) for polygon in polygons):
                totals[index] += people
                break
    return totals


class SearchWriter:
    """search.ndjson: one entry per line, sorted by nothing (the backend builds its own index)."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.temporary = path.with_name(f".{path.name}.part")
        self.handle = self.temporary.open("w", encoding="utf-8", newline="\n")
        self.count = 0

    def add(self, *, name: str, kind: str, type: str, point, rank: int, detail: str = "", category: str | None = None,
            bbox: list[float] | None = None, parish: str | None = None, aliases: list[str] | None = None,
            population: int | None = None) -> None:
        if not name or point is None:
            return
        entry: dict[str, Any] = {"n": name, "k": kind, "t": type, "x": _round(point[0]), "y": _round(point[1]),
                                 "r": int(rank)}
        if detail:
            entry["d"] = detail
        if category:
            entry["c"] = category
        if bbox and (bbox[2] - bbox[0] > 0.0003 or bbox[3] - bbox[1] > 0.0003):
            entry["b"] = [_round(v, 5) for v in bbox]
        if parish:
            entry["p"] = parish
        if aliases:
            unique = sorted({alias for alias in aliases if alias and fold(alias) != fold(name)})
            if unique:
                entry["a"] = unique
        if population:
            entry["pop"] = population
        self.handle.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n")
        self.count += 1

    def close(self) -> int:
        self.handle.close()
        self.temporary.replace(self.path)
        return self.count


def learn_names(destination: Path, speller: Speller) -> None:
    """Feeds every accented spelling of the official sources to the speller."""
    for layer in ("areas", "landmarks", "localities"):
        for feature in inec.features(destination, layer):
            speller.learn((feature.get("properties") or {}).get("n"))
    for layer, fields in (("poi-health", ("uni_nombre__nombre_oficial_", "par_descripcion", "can_descripcion")),
                          ("poi-education", ("nom_instit", "nom_parroq", "nom_canton")),
                          ("poi-tourism", ("nombre", "na2"))):
        for feature in read_collection(destination / f"{layer}.geojson"):
            props = feature.get("properties") or {}
            for field in fields:
                speller.learn(props.get(field))


def load_aliases(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        log(f"alias catalog not found: {path}")
        return []
    aliases = json.loads(path.read_text(encoding="utf-8")).get("aliases") or []
    log(f"{len(aliases)} popular names in {path}")
    return aliases


def math_isfinite(value: float) -> bool:
    return math.isfinite(value)
