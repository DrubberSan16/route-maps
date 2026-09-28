import json
import tempfile
import unittest
from pathlib import Path

from mapsdata.catalog import add_neighbourhood_groups, neighbourhood_families


def suburb(name, x, y, parish="090150", rank=62):
    return {"n": name, "k": "place", "t": "suburb", "x": x, "y": y, "r": rank, "d": "Guayaquil, Guayas",
            "b": [x - 0.001, y - 0.001, x + 0.001, y + 0.001], "p": parish}


class NeighbourhoodGroupsTest(unittest.TestCase):
    def test_families_drop_stages_sectors_and_sides(self):
        self.assertEqual(neighbourhood_families("Alborada IX Etapa"), ["Alborada"])
        self.assertEqual(neighbourhood_families("Urb. Kennedy Norte - I Etapa / Sector A"),
                         ["Kennedy Norte", "Kennedy"])
        self.assertEqual(neighbourhood_families("La Garzota I - II Etapa"), ["La Garzota"])
        self.assertEqual(neighbourhood_families("Urb Los Samanes 1ra Etapa"), ["Los Samanes"])
        self.assertEqual(neighbourhood_families("Urdesa Central"), ["Urdesa"])
        self.assertEqual(neighbourhood_families("Barrio del Seguro"), [])

    def test_stages_of_one_canton_become_one_searchable_neighbourhood(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "search.ndjson"
            entries = [
                suburb("Alborada I Etapa", -79.90, -2.14),
                suburb("Alborada II Etapa", -79.89, -2.13),
                suburb("Alborada III Etapa", -79.88, -2.12, rank=64),
                suburb("Alborada Etapa Única", -78.5, -0.2, parish="170150"),  # another city: no group
                suburb("Urdesa Central", -79.91, -2.17),
                {"n": "Urdesa", "k": "place", "t": "hamlet", "x": -77.8, "y": -1.0, "r": 56, "p": "150150"},
            ]
            path.write_text("\n".join(json.dumps(e) for e in entries) + "\n", encoding="utf-8")

            self.assertEqual(add_neighbourhood_groups(path), 1)
            self.assertEqual(add_neighbourhood_groups(path), 1)  # idempotent
            lines = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]

        groups = [e for e in lines if e.get("group")]
        self.assertEqual(len(groups), 1)
        alborada = groups[0]
        self.assertEqual((alborada["n"], alborada["t"], alborada["group"], alborada["r"]), ("Alborada", "suburb", 3, 66))
        self.assertEqual(alborada["b"], [-79.901, -2.141, -79.879, -2.119])
        self.assertEqual((alborada["x"], alborada["y"]), (-79.89, -2.13))  # the stage nearest the centre
        # A single stage ("Urdesa Central") is not grouped with the namesake hamlet of another canton.
        self.assertFalse(any(e["n"] == "Urdesa" and e.get("group") for e in lines))


if __name__ == "__main__":
    unittest.main()
