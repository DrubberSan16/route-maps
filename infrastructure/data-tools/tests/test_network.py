import json
import struct
import tempfile
import unittest
from pathlib import Path

from mapsdata import network
from mapsdata.text import Speller

LON = -79.9
LAT = -2.19


def street(points, kind="CALLE", name=None, parish="090150"):
    return {"type": "Feature", "properties": {"k": kind, "n": name, "p": parish},
            "geometry": {"type": "LineString", "coordinates": [[LON + x, LAT + y] for x, y in points]}}


def state_road(path: Path, points, ref="E40"):
    data = {"type": "FeatureCollection", "features": [{
        "type": "Feature",
        "properties": {"clasificac": "ARTERIAL", "codigo_via": ref, "troncales": "TRONCAL DE LA COSTA",
                       "numero_car": "2", "tipo_calza": "PAVIMENTO FLEXIBLE"},
        "geometry": {"type": "LineString", "coordinates": [[LON + x, LAT + y] for x, y in points]},
    }]}
    path.write_text(json.dumps(data), encoding="utf-8")


def read_header(path: Path) -> dict:
    blob = path.read_bytes()
    assert blob[:8] == b"RMGRAPH2"
    (length,) = struct.unpack_from("<I", blob, 8)
    return json.loads(blob[12:12 + length])


class NetworkTest(unittest.TestCase):
    def build(self, streets, road_points=None, is_land=None):
        directory = Path(tempfile.mkdtemp())
        roads = directory / "roads.geojson"
        if road_points:
            state_road(roads, road_points)
        result = network.build(directory, streets, roads, Speller(), {"090150": {"parish": "Guayaquil",
                                                                                 "canton": "Guayaquil",
                                                                                 "province": "Guayas"}},
                               {"region": "test"}, is_land=is_land)
        return directory, result["stats"]

    @staticmethod
    def town(x0, count=30, step=0.0003):
        """A grid-like town of `count` short streets starting at longitude offset x0."""
        streets = []
        for k in range(count):
            streets.append(street([(x0 + k * step, 0.01), (x0 + (k + 1) * step, 0.01)]))
        return streets

    def test_isolated_town_is_linked_over_land_only(self):
        main = self.town(0.0)
        isolated = self.town(0.03)  # ~2.4 km east of the main town
        _, stats = self.build(main + isolated, is_land=lambda lon, lat: True)
        self.assertEqual(stats["approximate_links"], 1)
        self.assertEqual(stats["components"], 1)
        _, stats = self.build(main + isolated, is_land=lambda lon, lat: False)
        self.assertEqual(stats.get("approximate_links", 0), 0)
        self.assertEqual(stats["approximate_links_over_water"], 1)
        self.assertEqual(stats["components"], 2)

    def test_state_road_stopping_short_of_a_town_is_linked_over_land_only(self):
        town = self.town(0.0)  # streets up to x = 0.009
        road = [(0.0145, 0.01), (0.05, 0.01)]  # the highway stops ~600 m before the town
        _, stats = self.build(town, road_points=road, is_land=lambda lon, lat: True)
        self.assertEqual(stats["loose_state_ends"], 2)
        self.assertEqual(stats["loose_end_links"], 1)
        self.assertEqual(stats["components"], 1)
        _, stats = self.build(town, road_points=road, is_land=lambda lon, lat: False)
        self.assertEqual(stats.get("loose_end_links", 0), 0)
        self.assertEqual(stats["loose_end_links_over_water"], 1)
        self.assertEqual(stats["components"], 2)

    def test_state_road_reaching_a_street_is_not_loose(self):
        _, stats = self.build(self.town(0.0), road_points=[(0.0094, 0.0102), (0.05, 0.0102)],
                              is_land=lambda lon, lat: True)
        self.assertEqual(stats["loose_state_ends"], 1)  # only the far end, in open country
        self.assertEqual(stats.get("loose_end_links", 0), 0)
        self.assertEqual(stats["components"], 1)

    def test_dead_end_a_few_metres_from_a_street_is_joined(self):
        _, stats = self.build([
            street([(0, 0), (0.002, 0)], "AVENIDA", "9 DE OCTUBRE"),
            street([(0.001, 0.00002), (0.001, 0.001)], "CALLE", "BOYACA"),  # 2 m gap
        ])
        self.assertEqual(stats["dead_ends_joined"], 1)
        self.assertEqual(stats["components"], 1)

    def test_distant_dead_end_stays_separate(self):
        _, stats = self.build([
            street([(0, 0), (0.002, 0)]),
            street([(0.001, 0.0002), (0.001, 0.001)]),  # 22 m away: a real dead end
        ])
        self.assertEqual(stats.get("dead_ends_joined", 0), 0)
        self.assertEqual(stats["components"], 2)

    def test_lines_are_split_at_shared_vertices(self):
        _, stats = self.build([
            street([(0, 0), (0.001, 0), (0.002, 0)]),
            street([(0.001, 0), (0.001, 0.001)]),
        ])
        self.assertEqual(stats["edges"], 3)
        self.assertEqual(stats["components"], 1)

    def test_state_road_duplicating_a_street_is_conflated(self):
        directory, stats = self.build(
            [street([(0, 0), (0.004, 0)], "AVENIDA", "25 DE JULIO")],
            road_points=[(-0.004, 0.00004), (0.008, 0.00004)],
        )
        # The stretch along the avenue is only hidden on the map: the state road stays whole in the
        # graph, linked to the avenue, so the backbone is never cut.
        self.assertGreater(stats["state_samples_duplicated"], 10)
        self.assertEqual(stats["state_parts_kept"], 2)
        self.assertEqual(stats["streets_promoted"], 1)
        self.assertGreaterEqual(stats["street_state_links"], 2)
        self.assertEqual(stats["components"], 1)
        roads = json.loads((directory / "map-roads.geojson").read_text(encoding="utf-8"))["features"]
        avenue = next(f for f in roads if f["properties"].get("name") == "Av. 25 de Julio")
        self.assertEqual(avenue["properties"]["ref"], "E40")
        self.assertEqual(avenue["properties"]["class"], "trunk")
        overview = [f for f in roads if f["properties"].get("scope") == "overview"]
        self.assertEqual(len(overview), 1)
        drawn_state = [f for f in roads if f["properties"].get("state") and f["properties"]["scope"] == "detail"]
        self.assertEqual(len(drawn_state), 2)  # only the stretches outside the town

    def test_graph_file_layout(self):
        directory, _ = self.build([street([(0, 0), (0.002, 0)], "AVENIDA", "9 DE OCTUBRE")])
        header = read_header(directory / "graph.bin")
        self.assertEqual(header["format"], "route-maps-graph")
        self.assertEqual(header["version"], 2)
        self.assertEqual(header["counts"], {"nodes": 2, "edges": 1, "names": 1})
        self.assertEqual(header["parishes"], [{"code": "090150", "parish": "Guayaquil", "canton": "Guayaquil",
                                               "province": "Guayas"}])
        blob = (directory / "graph.bin").read_bytes()
        (length,) = struct.unpack_from("<I", blob, 8)
        data_offset = -(-(12 + length) // 8) * 8
        names = next(s for s in header["sections"] if s["name"] == "names")
        start = data_offset + names["offset"]
        self.assertEqual(blob[start:start + names["length"]].decode("utf-8"), "Av. 9 de Octubre")
        for section in header["sections"]:
            self.assertEqual((data_offset + section["offset"]) % 8, 0)

    def test_railways_are_not_roads(self):
        _, stats = self.build([street([(0, 0), (0.002, 0)], "LINEA FERREA")] +
                              [street([(0, 0.001), (0.002, 0.001)])])
        self.assertEqual(stats["streets"], 1)


if __name__ == "__main__":
    unittest.main()
