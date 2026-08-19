"""The fonts the printed board is set in.

Two Hebrew serifs travel with the program rather than being assumed to be installed. The
web version ships them for phones, which have none of David, Frank Ruehl or Times New
Roman and fall back to a sans for Hebrew; a desktop program has the same problem on any
machine that is not the one these boards have always been printed from.

Which stands in for which is the same mapping the web version uses. Frank Ruhl Libre and
Times New Roman are both traditional high contrast Hebrew serifs, so one covers the other
closely. David is a lighter semi-serif and only matches itself. Arial and Segoe UI
deliberately get no stand-in: every device already has a Hebrew sans, and shipping a font
to say the same thing would be pointless.

SIL Open Font License 1.1, see assets/fonts/ in the repository root for the licences.
"""
import sys
from pathlib import Path

from PySide6.QtGui import QFontDatabase

FONT_CHOICES = ["David", "David Libre", "Guttman Yad", "Frank Ruehl", "Times New Roman", "Arial", "Segoe UI"]

HEBREW_STAND_IN = {
    "Times New Roman": "Frank Ruhl Libre",
    "Frank Ruehl": "Frank Ruhl Libre",
    "Guttman Yad": "Frank Ruhl Libre",
    "David": "David Libre",
    "David Libre": "David Libre",
}

# Last resorts, after the chosen face and its stand-in. Liberation Serif is metric
# compatible with Times New Roman and is what a Linux machine will actually have; DejaVu
# covers the rest.
FALLBACK_SERIF = ["Liberation Serif", "DejaVu Serif", "serif"]
FALLBACK_SANS = ["Liberation Sans", "DejaVu Sans", "sans-serif"]

_loaded = False


def _font_dir() -> Path:
    here = Path(__file__).resolve()
    bundle = getattr(sys, "_MEIPASS", None)
    candidates = ([Path(bundle) / "assets" / "fonts"] if bundle else []) + [here.parent.parent / "assets" / "fonts"]
    for folder in candidates:
        if folder.exists():
            return folder
    raise FileNotFoundError("bundled fonts not found; looked in " + ", ".join(str(c) for c in candidates))


def load_bundled() -> list:
    """Registers the shipped faces with Qt. Safe to call more than once."""
    global _loaded
    if _loaded:
        return []
    families = []
    for path in sorted(_font_dir().glob("*.ttf")):
        font_id = QFontDatabase.addApplicationFont(str(path))
        if font_id == -1:
            raise RuntimeError(f"Qt refused to load {path.name}")
        families.extend(QFontDatabase.applicationFontFamilies(font_id))
    _loaded = True
    return families


def stack_for(family: str) -> list:
    """The full preference order for a chosen face: the real font first, because the
    machines these are printed from do have it, then the shipped stand-in, then a generic.
    """
    stand_in = HEBREW_STAND_IN.get(family)
    generic = FALLBACK_SANS if family in ("Arial", "Segoe UI") else FALLBACK_SERIF
    return [family] + ([stand_in] if stand_in else []) + generic
