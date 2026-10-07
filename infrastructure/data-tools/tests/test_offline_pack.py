"""Offline packs of the mobile app: the road graph and search index of a region in one file."""

import argparse
import json
import math
import struct
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from mapsdata import offline_pack

from .test_native_data import native_data

# Written by the backend from its own engines (npm run fixtures:offline): the fixture city, what the
# backend answers on it, and the pack the mobile app's tests load.
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "offline"
REGENERATE = "run `npm run fixtures:offline` in backend/ to regenerate the offline fixture"


def fixture_packs() -> list[dict]:
    """The packs of the fixture (expected.json "packs"): the whole city first."""
    return json.loads((FIXTURE / "expected.json").read_text(encoding="utf-8"))["packs"]


def fixture_pack(pack: dict | None = None, **options):
    pack = pack or fixture_packs()[0]
    settings = {"bbox": pack["bbox"], "margin_km": float(pack["marginKm"]), "region": pack["region"],
                "name": pack["name"]}
    settings.update(options)
    return offline_pack.build_pack(FIXTURE / "graph.bin", FIXTURE / "search.ndjson", **settings)


def sections(pack: bytes):
    header, parts = offline_pack.decode(pack, offline_pack.PACK_MAGIC)
    graph = offline_pack.decode(parts["graph"], offline_pack.GRAPH_MAGIC)
    search = offline_pack.decode(parts["search"], offline_pack.SEARCH_MAGIC)
    return header, graph, search


def strings(offsets, blob: bytes) -> list[str]:
    return [blob[offsets[i]:offsets[i + 1]].decode("utf-8") for i in range(len(offsets) - 1)]


class OfflinePackTest(unittest.TestCase):
    def test_fixture_packs_are_current(self):
        for pack in fixture_packs():
            built, _ = fixture_pack(pack)
            self.assertTrue(built == (FIXTURE / pack["file"]).read_bytes(),
                            f"{pack['file']} is out of date: {REGENERATE}")

    def test_folds_text_like_the_backend(self):
        expected = json.loads((FIXTURE / "expected.json").read_text(encoding="utf-8"))
        for text, folded in expected["folds"]:
            self.assertEqual(offline_pack.search_fold(text), folded, text)

    def test_whole_region_keeps_the_graph_and_the_index(self):
        pack, summary = fixture_pack()
        header, (graph_header, graph), (search_header, search) = sections(pack)
        source_header, source = offline_pack.decode((FIXTURE / "graph.bin").read_bytes(), offline_pack.GRAPH_MAGIC)
        self.assertEqual(header["format"], "route-maps-offline-pack")
        city = fixture_packs()[0]
        self.assertEqual(header["coverage"], offline_pack.coverage_of(city["bbox"], city["marginKm"]))
        self.assertEqual(header["bbox"], city["bbox"])
        self.assertEqual(summary["counts"], {"nodes": 97, "edges": 148, "entries": 67})
        for name in ("node_lon", "node_lat", "edge_u", "edge_v", "edge_len", "edge_cls", "edge_flags", "edge_name",
                     "edge_ref", "edge_parish", "shape_off", "shape_lon", "shape_lat", "names_off", "names"):
            self.assertEqual(graph[name], source[name], name)
        self.assertEqual(graph_header["parishes"], source_header["parishes"])
        lines = (FIXTURE / "search.ndjson").read_text(encoding="utf-8").splitlines()
        self.assertEqual(search_header["counts"]["entries"], len(lines))

    def test_search_section_is_the_backend_index(self):
        _, _, (header, search) = sections(fixture_pack()[0])
        entries = [json.loads(line) for line in (FIXTURE / "search.ndjson").read_text(encoding="utf-8").splitlines()]
        self.assertEqual(strings(search["name_off"], search["name"]), [entry["n"] for entry in entries])
        folded = strings(search["folded_off"], search["folded"])
        self.assertEqual(folded[entries.index(next(e for e in entries if e["n"] == "Parque Seminario"))],
                         "parque seminario | parque de las iguanas")
        vocabulary = strings(search["name_vocab_off"], search["name_vocab"])
        self.assertEqual(vocabulary, sorted(vocabulary))
        hospital = vocabulary.index("hospital")
        posted = list(search["name_post"][search["name_post_off"][hospital]:search["name_post_off"][hospital + 1]])
        self.assertEqual(posted, [index for index, entry in enumerate(entries) if "hospital" in
                                  offline_pack.search_fold(entry["n"]).split(" ")])
        self.assertEqual(header["kinds"], ["admin", "place", "poi", "street"])
        self.assertEqual(list(search["grid_key"]), sorted(search["grid_key"]))
        gridded = sorted(search["grid_entry"])
        self.assertEqual(gridded, [i for i, entry in enumerate(entries) if entry["k"] in ("poi", "place")])
        no_box = next(i for i, entry in enumerate(entries) if "b" not in entry)
        self.assertTrue(all(math.isnan(value) for value in search["bbox"][no_box * 4:no_box * 4 + 4]))
        boxed = next(i for i, entry in enumerate(entries) if "b" in entry)
        self.assertEqual(list(search["bbox"][boxed * 4:boxed * 4 + 4]),
                         [struct.unpack("<f", struct.pack("<f", value))[0] for value in entries[boxed]["b"]])

    def test_clips_to_the_region_and_renumbers_in_order(self):
        # Durán and El Paraíso only: the roads reaching the area keep their nodes outside it.
        duran = fixture_packs()[1]
        area = duran["bbox"]
        pack, summary = fixture_pack(duran)
        _, (graph_header, graph), (_, search) = sections(pack)
        source_header, source = offline_pack.decode((FIXTURE / "graph.bin").read_bytes(), offline_pack.GRAPH_MAGIC)
        source_names = strings(source["names_off"], source["names"])
        names = strings(graph["names_off"], graph["names"])
        self.assertLess(summary["counts"]["edges"], 148)
        self.assertIn("Vía Durán-Tambo", names)
        self.assertIn("C. Única", names)
        self.assertNotIn("Av. Quito", names)
        # Names, parishes and nodes keep the order of the region files.
        self.assertEqual(names, [name for name in source_names if name in names])
        self.assertEqual([p["parish"] for p in graph_header["parishes"]], ["Eloy Alfaro", "El Paraíso"])
        source_nodes = list(zip(source["node_lon"], source["node_lat"]))
        nodes = list(zip(graph["node_lon"], graph["node_lat"]))
        positions = [source_nodes.index(point) for point in nodes]
        self.assertEqual(positions, sorted(positions))
        source_edges = [(source_nodes[u], source_nodes[v]) for u, v in zip(source["edge_u"], source["edge_v"])]
        positions = [source_edges.index((nodes[u], nodes[v])) for u, v in zip(graph["edge_u"], graph["edge_v"])]
        self.assertEqual(positions, sorted(positions))
        self.assertEqual(list(graph["edge_len"]), [source["edge_len"][edge] for edge in positions])
        for edge in range(summary["counts"]["edges"]):
            u, v = graph["edge_u"][edge], graph["edge_v"][edge]
            lons = [graph["node_lon"][u], graph["node_lon"][v],
                    *graph["shape_lon"][graph["shape_off"][edge]:graph["shape_off"][edge + 1]]]
            lats = [graph["node_lat"][u], graph["node_lat"][v],
                    *graph["shape_lat"][graph["shape_off"][edge]:graph["shape_off"][edge + 1]]]
            self.assertTrue(min(lons) / 1e7 <= area[2] and max(lons) / 1e7 >= area[0]
                            and min(lats) / 1e7 <= area[3] and max(lats) / 1e7 >= area[1], edge)
        kept = strings(search["name_off"], search["name"])
        self.assertIn("Terminal Terrestre de Durán", kept)
        self.assertIn("Guayas", kept)  # the province reaches the area
        self.assertNotIn("Hospital Luis Vernaza", kept)

    def test_margin_widens_the_area(self):
        area = offline_pack.coverage_of([-80.1, -2.33, -79.78, -2.0], 5)
        self.assertAlmostEqual(area[1], -2.33 - 5000 / 111_195.08, places=6)
        self.assertGreater(area[2] - (-79.78), 5000 / 111_195.08)
        self.assertLess(area[2] - (-79.78), 0.046)
        with self.assertRaises(ValueError):
            offline_pack.coverage_of([1, 1, 0, 2], 5)

    def test_rebuilding_the_same_data_gives_the_same_bytes(self):
        first, _ = fixture_pack(bbox=[-79.9, -2.2, -79.85, -2.17], margin_km=1)
        second, _ = fixture_pack(bbox=[-79.9, -2.2, -79.85, -2.17], margin_km=1)
        self.assertEqual(first, second)

    def test_pack_command_writes_the_file(self):
        city = fixture_packs()[0]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "fixture" / city["file"]
            args = argparse.Namespace(graph=FIXTURE / "graph.bin", search=FIXTURE / "search.ndjson",
                                      bbox=",".join(str(value) for value in city["bbox"]),
                                      margin_km=float(city["marginKm"]), region=city["region"], name=city["name"],
                                      output=output)
            with mock.patch("builtins.print"):
                native_data.command_pack(args)
            self.assertEqual(output.read_bytes(), (FIXTURE / city["file"]).read_bytes())
            self.assertEqual(sorted(path.name for path in output.parent.iterdir()), [city["file"]])
            with self.assertRaises(SystemExit):
                native_data.command_pack(argparse.Namespace(**{**vars(args), "bbox": "1,2,3"}))
            with self.assertRaises(SystemExit):
                native_data.command_pack(argparse.Namespace(**{**vars(args), "graph": Path(directory) / "none"}))


if __name__ == "__main__":
    unittest.main()
