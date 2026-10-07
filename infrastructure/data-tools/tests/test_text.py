import unittest

import json
import tempfile
from pathlib import Path

from mapsdata.catalog import add_aliases
from mapsdata.text import Speller, clean, fold, normalize_kind, street_aliases, street_label, title


class TextTest(unittest.TestCase):
    def setUp(self) -> None:
        self.speller = Speller()
        self.speller.learn("JUAN GÓMEZ RENDÓN (PROGRESO)")
        self.speller.learn("LOTIZACIÓN HUERTOS Y FLORES")
        self.speller.learn("LOTIZACIÓN LAS PALMAS")
        self.speller.freeze()

    def test_fold_removes_case_accents_and_punctuation(self) -> None:
        self.assertEqual(fold("Malecón Simón-Bolívar (2000)"), "malecon simon bolivar 2000")
        self.assertEqual(fold("Peñón"), "penon")
        self.assertEqual(fold(None), "")

    def test_clean_drops_placeholders_and_export_damage(self) -> None:
        self.assertIsNone(clean("S/N"))
        self.assertIsNone(clean(" 0 "))
        self.assertIsNone(clean(None))
        self.assertEqual(clean("  AV.  9 DE  OCTUBRE "), "AV. 9 DE OCTUBRE")
        self.assertEqual(clean("2ï¿½ PASAJE 24 S-O"), "2� PASAJE 24 S-O")

    def test_title_restores_accents_and_particles(self) -> None:
        self.assertEqual(title("MALECON SIMON BOLIVAR", self.speller), "Malecón Simón Bolívar")
        self.assertEqual(title("9 DE OCTUBRE Y BOYACA", self.speller), "9 de Octubre y Boyaca")
        self.assertEqual(title("JUAN GOMEZ RENDON", self.speller), "Juan Gómez Rendón")
        self.assertEqual(title("LOTIZACION LAS PALMAS", self.speller), "Lotización las Palmas")
        self.assertEqual(title("DR. JUAN MONTALVAN CORNEJO", self.speller), "Dr. Juan Montalván Cornejo")
        self.assertEqual(title("TERMINAL TERRESTRE DE GUAYAQUIL", self.speller), "Terminal Terrestre de Guayaquil")
        self.assertEqual(title("A", self.speller), "A")
        self.assertEqual(title("C-10", self.speller), "C-10")
        self.assertEqual(title("Oe18B", self.speller), "Oe18B")
        self.assertEqual(title("EL ORO", self.speller), "El Oro")

    def test_title_restores_the_enye_written_as_ni(self) -> None:
        self.assertEqual(title("TERMINAL TERRESTRE DE BANIOS", self.speller), "Terminal Terrestre de Baños")
        self.assertEqual(title("NUESTRA SENIORA DE LA PAZ", self.speller), "Nuestra Señora de la Paz")
        self.assertEqual(title("SAN ANTONIO DE LA UNION", self.speller), "San Antonio de la Unión")
        self.assertEqual(title("COLONIA DANIEL", self.speller), "Colonia Daniel")

    def test_title_repairs_lost_characters(self) -> None:
        self.assertEqual(title(clean("2ï¿½ PASAJE 24 S-O"), self.speller), "2° Pasaje 24 S-O")

    def test_street_label_guayaquil_nomenclature(self) -> None:
        self.assertEqual(
            street_label("AVENIDA", "12 S-E (MALECON SIMON BOLIVAR PALACIOS)", self.speller),
            "Av. 12 S-E - Malecón Simón Bolívar Palacios",
        )
        self.assertEqual(street_label("CALLE", "MALECON DEL SALADO", self.speller), "Malecón del Salado")
        self.assertEqual(street_label("CALLE", "SENEGAL", self.speller), "C. Senegal")
        self.assertEqual(street_label("AVENIDA", "25 DE JULIO", self.speller), "Av. 25 de Julio")
        self.assertEqual(street_label("CALLEJON", "2DO CJON.5 N-O (MALECON DEL SALADO)", self.speller),
                         "2do Cjón. 5 N-O - Malecón del Salado")
        self.assertEqual(street_label("PASAJE", "10MO PSJE. 25A N-O", self.speller), "10mo Pje. 25A N-O")
        self.assertEqual(street_label("CALLE", "49 S-O (DR. JUAN MONTALVAN CORNEJO)", self.speller),
                         "C. 49 S-O - Dr. Juan Montalván Cornejo")
        self.assertEqual(street_label("AVENIDA", "EJE S-O (BLVD. 9 DE OCTUBRE)", self.speller),
                         "Eje S-O - Blvd. 9 de Octubre")
        self.assertEqual(street_label("CALLE", "4", self.speller), "C. 4")
        self.assertIsNone(street_label("CALLE", None, self.speller))

    def test_street_aliases_and_kinds(self) -> None:
        self.assertEqual(street_aliases("12 S-E (MALECON SIMON BOLIVAR PALACIOS)"), ["MALECON SIMON BOLIVAR PALACIOS"])
        self.assertEqual(normalize_kind("PAETONAL"), "PEATONAL")
        self.assertEqual(normalize_kind("Circunvalación"), "CIRCUNVALACION")

    def test_popular_aliases_are_written_to_the_matched_entry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "search.ndjson"
            path.write_text(
                json.dumps({"n": "Terminal Terrestre de Guayaquil", "k": "poi", "t": "bus_station",
                            "x": -79.88, "y": -2.14, "r": 60, "p": "090150"}) + "\n",
                encoding="utf-8",
            )
            report = add_aliases(path, [{
                "names": ["Terminal de buses de Guayaquil"],
                "target": {"name": "terminal terrestre guayaquil", "kind": "poi", "parish": "0901"},
                "rank": 72,
            }])
            entry = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(report, {"resolved": 1, "unresolved": 0})
        self.assertEqual(entry["a"], ["Terminal de buses de Guayaquil"])
        self.assertEqual(entry["r"], 72)


if __name__ == "__main__":
    unittest.main()
