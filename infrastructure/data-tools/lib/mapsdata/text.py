"""Names of the official sources turned into display labels and search keys.

The national cartography stores names in upper case and, most of the time, without
accents ("MALECON SIMON BOLIVAR"). Labels are rebuilt in Spanish title case with the
accents restored from a curated list plus the accented spellings seen in the other
official sources ("Malecón Simón Bolívar"); search keys ignore case and accents.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter

_SPACES = re.compile(r"\s+")
_NON_WORD = re.compile(r"[^0-9a-z]+")
_PLACEHOLDER = re.compile(r"^(?:S/?N\.?|S\.N\.?|N/?N|SIN NOMBRE|NINGUNO|0+|-+|\.+|\?+)$", re.IGNORECASE)
# UTF-8 bytes decoded twice ("ï¿½") or replacement characters left by an export.
_BROKEN = re.compile("(?:ï¿½|�|Ã¯Â¿Â½)")

# Short or ambiguous words that must never receive an accent.
_NEVER_ACCENT = {
    "de", "el", "la", "las", "los", "del", "y", "e", "o", "u", "a", "en", "al", "mi", "tu", "te",
    "se", "si", "mas", "solo", "aun", "este", "ese", "esta", "esa", "pena", "nina", "ano", "papa",
    "mama", "oscar",
}

# Spellings that are always accented in names of places, streets and people in Ecuador.
_CURATED = """
Abdón Acción Adrián Agrícola Agustín Águila Águilas Alausí Alemán Alelí Algodón Álvarez Amazónica
Amazónico América Américas Américo Andrés Ángel Ángeles Angélica Aníbal Antártida Anunciación Árbol
Árboles Asociación Asunción Atención Atlántico Aviación Avilés Azúcar Bahía Bambú Baños Barragán
Basílica Básica Batallón Bélgica Belén Benítez Benjamín Berlín Biblián Biológico Bogotá Bolívar
Cámara Camarón Canadá Cañar Cañaveral Cañón Cápac Capitán Capulí Caráquez Cárdenas Castaños
Católica Católico Céspedes César Chávez Ciprés Circunvalación Clínica Colibrí Comité Compañía
Concepción Cóndor Constitución Construcción Corazón Córdoba Córdova Corporación Cristóbal Cumbayá
Dávalos Delfín Dirección Distribución Domínguez Durán Edén Educación Efraín Elías Energía Eléctrica
Eléctrico España Espín Estación Exposición Farmacéutica Félix Fermín Fernández Francés Fundación
Galápagos Gálvez Garcés García Gavilán Génesis Geográfico Germán Girón Gobernación Gómez González
Guardería Guayacán Guerrón Guzmán Haití Halcón Hernández Héroe Héroes Héctor Ibáñez Informática
Información Inglés Inés Integración Jamaica Japón Jardín Jazmín Jerónimo Jerusalén Jesús Jiménez
Joaquín José Julián Junín Juárez Lotización León López Lucía Macará Macías Maíz Malecón Manabí
Marqués Martí Martín Martínez Mártires Matías Mecánica Mecánico Médica Médico Mejía Melón Méndez
México Moisés Mónica Montalván Montaña Muñoz Nación Narváez Nicolás Níspero Niño Niños Núñez
Odontológica Olímpica Olímpico Ordóñez Orquídea Orquídeas Pacífico Páez Paján Panamá Paraíso
París Pelícano Peñafiel Pérez Perú Petróleo Píllaro Pío Plátano Pública Público Policía Politécnica
Politécnico Producción Próceres Psicológico Pujilí Purísima Química Quiñónez Ramírez Ramón
Recreación Rehabilitación Rendón Revolución Rodríguez Roldós Román Rubén Sáenz Salomé Samborondón
Sánchez Sangolquí Santísima Santísimo Saquisilí Sebastián Señor Señora Sígsig Simón Sofía Sucúa
Sucumbíos Suárez Técnica Técnico Tecnológica Tecnológico Telefónica Tiburón Tomás Tucán Tulcán
Túnel Túpac Unión Urbanización Valdés Vásquez Vázquez Velásquez Vélez Verónica Vía Víctor Yánez
Logroño Piñas Peñaherrera Ibarra Jipijapa Sucumbíos Calderón Tabacundo Cayambe Machachi Guamaní
Quitumbe Carcelén Cotocollao Chillogallo Rumiñahui Iñaquito Mañosca María Río Ríos Tránsito
Terrestre Aeropuerto Rocafuerte Olmedo Ávila Ángela Érica Óscar Úrsula Oriental Occidental
"""


def fold(text: str | None) -> str:
    """Search key: lower case, no accents, only letters and digits separated by one space."""
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    stripped = "".join(char for char in decomposed if not unicodedata.combining(char))
    return _SPACES.sub(" ", _NON_WORD.sub(" ", stripped.replace("ñ", "n"))).strip()


def _fold_word(word: str) -> str:
    decomposed = unicodedata.normalize("NFKD", word.lower())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


class Speller:
    """Restores accents on upper-case, unaccented words."""

    def __init__(self) -> None:
        self._seen: dict[str, Counter[str]] = {}
        self._known: dict[str, str] = {}
        for word in _CURATED.split():
            self._known[_fold_word(word)] = word.lower()

    def learn(self, text: str | None) -> None:
        if not text:
            return
        for word in re.findall(r"[^\W\d_]+", text):
            lower = word.lower()
            folded = _fold_word(lower)
            if folded != lower and folded not in _NEVER_ACCENT:
                self._seen.setdefault(folded, Counter())[lower] += 1

    def freeze(self, minimum: int = 2) -> None:
        """Adopts the accented spellings seen at least `minimum` times."""
        for folded, spellings in self._seen.items():
            spelling, count = spellings.most_common(1)[0]
            if count >= minimum and folded not in self._known:
                self._known[folded] = spelling

    def word(self, lower: str) -> str:
        if lower in _NEVER_ACCENT:
            return lower
        return self._known.get(_fold_word(lower), lower)

    def knows(self, lower: str) -> bool:
        return _fold_word(lower) in self._known


_LOWER_WORDS = {"de", "del", "la", "las", "los", "el", "y", "e", "o", "u", "a", "en", "al", "con", "por", "para", "sin"}
_ABBREVIATIONS = {
    "av": "Av.", "avda": "Av.", "cl": "C.", "cll": "C.", "psje": "Pje.", "pje": "Pje.", "cjon": "Cjón.",
    "cj": "Cjón.", "pse": "Paseo", "peat": "Peatonal", "tvl": "Transversal", "dgl": "Diagonal",
    "rto": "Retorno", "herr": "Herradura", "esc": "Escalinata", "blvd": "Blvd.", "blvr": "Blvd.",
    "dr": "Dr.", "dra": "Dra.", "gral": "Gral.", "crnel": "Crnel.", "cnel": "Cnel.", "sgto": "Sgto.",
    "tnte": "Tnte.", "tte": "Tte.", "cap": "Cap.", "cpt": "Cap.", "ing": "Ing.", "arq": "Arq.",
    "ab": "Ab.", "abg": "Abg.", "lcdo": "Lcdo.", "lcda": "Lcda.", "lic": "Lic.", "prof": "Prof.",
    "sta": "Sta.", "sto": "Sto.", "sn": "San", "mons": "Mons.", "pbro": "Pbro.", "fr": "Fr.",
    "cdla": "Cdla.", "coop": "Coop.", "urb": "Urb.", "mz": "Mz.", "km": "km", "nro": "N.º",
    "no": "N.º", "gob": "Gob.", "mcal": "Mcal.", "alm": "Alm.", "pdte": "Pdte.", "hno": "Hno.",
}
_ORDINAL = re.compile(r"^(\d+)(er|ero|era|ro|ra|do|da|to|ta|mo|ma|vo|va|no|na|avo|ava|°|º)\.?$", re.IGNORECASE)
# Codes of the census nomenclature: "25A", "C-10", "E3B", "1-A", "B-P", "KK12" and lone letters.
_CODE = re.compile(r"^(?=.*\d)[0-9A-Za-z]+(?:[-/][0-9A-Za-z]+)*$|^[A-Za-z]{1,2}(?:-[0-9A-Za-z]+)+$")
_DIRECTION = re.compile(r"^(?:N|S|E|O|NE|NO|SE|SO|N-E|N-O|S-E|S-O)$", re.IGNORECASE)
# Two-letter Spanish words (the other two-letter tokens are codes such as "BJ" or "AQ").
_SHORT_WORDS = {
    "de", "la", "el", "en", "al", "lo", "le", "se", "su", "tu", "mi", "ya", "si", "yo", "un", "va",
    "da", "ve", "ni", "os", "ex", "fe", "ti", "oe", "no", "sn",
}


def clean(value: object) -> str | None:
    """Trimmed text without export damage, or None for empty values and placeholders."""
    if value is None:
        return None
    text = str(value)
    text = _BROKEN.sub("�", text)
    text = text.replace(" ", " ").replace("´", "'").replace("`", "'")
    text = _SPACES.sub(" ", text).strip(" .,;:-\t")
    if not text or _PLACEHOLDER.match(text):
        return None
    return text


def repair(text: str, speller: Speller) -> str:
    """Rebuilds characters lost by a broken export with the speller vocabulary."""
    if "�" not in text:
        return text
    text = re.sub(r"(\d)�", r"\1°", text)

    def guess(match: re.Match[str]) -> str:
        word = match.group(0)
        for candidate in "ÑÁÉÍÓÚÜ":
            attempt = word.replace("�", candidate, 1)
            if speller.knows(attempt.lower()):
                return attempt
        return word.replace("�", "Ñ" if re.search("[AEIOU]�[AEIOU]", word, re.IGNORECASE) else "")

    text = re.sub(r"[^\W\d_]*�[^\W\d_]*", guess, text)
    return text.replace("�", "")


def title(text: str | None, speller: Speller | None = None) -> str | None:
    """Spanish title case: "AV. 9 DE OCTUBRE Y BOYACA" -> "Av. 9 de Octubre y Boyacá"."""
    if not text:
        return None
    speller = speller or _DEFAULT_SPELLER
    text = repair(text, speller)
    out: list[str] = []
    previous = ""
    for raw in text.split(" "):
        if not raw:
            continue
        out.append(_title_word(raw, not out, previous, speller))
        previous = raw
    return " ".join(out)


def _title_word(raw: str, first: bool, previous: str, speller: Speller) -> str:
    # Keep punctuation around the word: "(MALECON" -> "(Malecón".
    match = re.match(r"^([\"'(\[¿¡]*)(.*?)([\"'),.;:\]?!]*)$", raw)
    prefix, core, suffix = match.groups() if match else ("", raw, "")
    if not core:
        return raw
    lower = core.lower()
    if lower in _ABBREVIATIONS and (suffix.startswith(".") or lower in {"av", "cdla", "coop", "psje", "cjon"}):
        value = _ABBREVIATIONS[lower]
        if value.endswith(".") and suffix.startswith("."):
            suffix = suffix[1:]
        return prefix + value + suffix
    ordinal = _ORDINAL.match(core)
    if ordinal:
        number, ending = ordinal.groups()
        ending = "°" if ending in "°º" else ending.lower()
        return prefix + number + ending + suffix
    if core != core.upper() and core != core.lower():
        return prefix + core + suffix  # already mixed case (Quito's "Oe18B")
    after_code = bool(previous) and (any(char.isdigit() for char in previous) or len(previous.strip(".")) <= 2)
    if not first and lower == "y":
        return prefix + "y" + suffix
    if not first and lower in {"e", "o", "u", "a"} and not after_code:
        return prefix + lower + suffix
    if _DIRECTION.match(core) and (len(core) > 1 or first or after_code):
        return prefix + core.upper() + suffix
    if _CODE.match(core) or (core.isalpha() and len(core) <= 2 and lower not in _SHORT_WORDS):
        return prefix + core.upper() + suffix
    if "-" in core:
        parts = core.split("-")
        return prefix + "-".join(_title_word(part, first and i == 0, "", speller) for i, part in enumerate(parts)) + suffix
    if not first and lower in _LOWER_WORDS:
        return prefix + lower + suffix
    word = speller.word(_restore_enye(lower, speller))
    return prefix + word[:1].upper() + word[1:] + suffix


def _restore_enye(lower: str, speller: Speller) -> str:
    """The census exports write Ñ as "NI" ("BANIOS", "SENIORA"): restore it when the spelling with
    Ñ is a known word ("baños", "señora") and the original is not."""
    if "ni" not in lower or speller.knows(lower):
        return lower
    for match in re.finditer(r"ni(?=[aeiou])", lower):
        candidate = lower[:match.start()] + "ñ" + lower[match.end():]
        if speller.knows(candidate):
            return candidate
    return lower


_DEFAULT_SPELLER = Speller()

#: Street types of the national cartography: (label prefix, words already naming the type).
STREET_KINDS = {
    "AVENIDA": "Av.",
    "CALLE": "C.",
    "PASAJE": "Pje.",
    "CALLEJON": "Callejón",
    "PEATONAL": "Peatonal",
    "SENDERO": "Sendero",
    "ESCALINATA": "Escalinata",
    "PASEO": "Paseo",
    "PANAMERICANA": "Panamericana",
    "CARRETERA": "Carretera",
    "AUTOPISTA": "Autopista",
    "TRANSVERSAL": "Transversal",
    "REDONDEL": "Redondel",
    "DIAGONAL": "Diagonal",
    "CAMINO": "Camino",
    "RETORNO": "Retorno",
    "CIRCUNVALACION": "Circunvalación",
    "HERRADURA": "Herradura",
    "VIA": "Vía",
    "TUNEL": "Túnel",
    "LINEA FERREA": "Línea férrea",
}
KIND_TYPOS = {"PAETONAL": "PEATONAL", "ESCALINTA": "ESCALINATA", "CIRCUNVALCION": "CIRCUNVALACION"}
_TYPE_WORDS = re.compile(
    r"^(?:\d+\S*\s+)?(?:AV|AVDA|AVENIDA|CL|CALLE|PSJE|PJE|PASAJE|CJON|CJ|CALLEJON|PEAT|PEATONAL|PSE|PASEO|"
    r"TVL|TRANSVERSAL|DGL|DIAGONAL|RTO|RETORNO|HERR|HERRADURA|ESC|ESCALINATA|SENDERO|MALECON|BLVD|BLVR|"
    r"BOULEVARD|BULEVAR|VIA|AUTOPISTA|CARRETERA|PANAMERICANA|CIRCUNVALACION|PERIMETRAL|CAMINO|REDONDEL|"
    r"TUNEL|PUENTE|VIADUCTO|ACCESO|RAMAL|EJE|PASO|INTERCAMBIADOR|SUBIDA|BAJADA|ENTRADA|CARRERA)\b\.?",
    re.IGNORECASE,
)


def normalize_kind(kind: object) -> str | None:
    value = clean(kind)
    if not value:
        return None
    value = fold(value).upper()
    return KIND_TYPOS.get(value, value)


def street_label(kind: str | None, name: str | None, speller: Speller | None = None) -> str | None:
    """Display name of a street of the national cartography.

    "AVENIDA" + "12 S-E (MALECON SIMON BOLIVAR PALACIOS)" -> "Av. 12 S-E - Malecón Simón Bolívar Palacios"
    "CALLE" + "SENEGAL" -> "C. Senegal";  "CALLEJON" + "2DO CJON.5 N-O" -> "2do Cjón. 5 N-O".
    """
    if not name:
        return None
    speller = speller or _DEFAULT_SPELLER
    raw = re.sub(r"\.(?=\S)", ". ", name)  # "CJON.5" -> "CJON. 5"
    raw = _SPACES.sub(" ", raw).strip()
    main, extra = raw, None
    parenthesis = re.match(r"^(.*?)\s*\(\s*(.+?)\s*\)?\s*$", raw)
    if parenthesis and parenthesis.group(1):
        main, extra = parenthesis.group(1).strip(" -"), parenthesis.group(2).strip()
    elif parenthesis:
        main = parenthesis.group(2).strip()
    label = title(main, speller) or ""
    if not _TYPE_WORDS.match(main):
        prefix = STREET_KINDS.get(kind or "", "")
        if prefix:
            label = f"{prefix} {label}"
    if extra:
        extra_label = title(extra, speller)
        if extra_label and fold(extra_label) != fold(label):
            label = f"{label} - {extra_label}"
    return label.strip() or None


def street_aliases(name: str | None) -> list[str]:
    """Extra search keys of a street: the name in parentheses ("Malecon Simon Bolivar")."""
    if not name:
        return []
    found = re.findall(r"\(([^)]+)\)?", name)
    return [value.strip() for value in found if value.strip()]
