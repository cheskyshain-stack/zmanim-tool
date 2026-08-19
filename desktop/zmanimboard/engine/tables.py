"""The ported Hebrew calendar lookup tables (js/data-loader.js).

These are exact copies of the workbook's PARSHA_TABLE_CHUTZ, PARSHA_TABLE_EY,
PARSHA_NAMES_TABLE and SPECIAL_DAYS_TABLE. They must travel inside the program: it has to
work with no network and no files sitting beside the executable.

Loaded from whichever of these exists, in order, so development reads the repository's own
copy and there is only ever one source of truth:

  1. the PyInstaller bundle, when running as a frozen executable
  2. desktop/zmanimboard/data, where the build script puts them
  3. the repository's own data/ folder
"""
import json
import sys
from dataclasses import dataclass
from pathlib import Path

FILES = {
    "parsha_chutz": "parsha_chutz.json",
    "parsha_ey": "parsha_ey.json",
    "parsha_names": "parsha_names.json",
    "special_days": "special_days.json",
}


@dataclass(frozen=True)
class Tables:
    parsha_chutz: dict
    parsha_ey: dict
    parsha_names: dict
    special_days: dict


def _candidates():
    here = Path(__file__).resolve()
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle:
        yield Path(bundle) / "data"
    yield here.parent.parent / "data"
    yield here.parents[3] / "data"


def data_dir() -> Path:
    for folder in _candidates():
        if (folder / FILES["parsha_chutz"]).exists():
            return folder
    tried = "\n  ".join(str(c) for c in _candidates())
    raise FileNotFoundError(f"Hebrew calendar tables not found. Looked in:\n  {tried}")


_cached: Tables | None = None


def load() -> Tables:
    global _cached
    if _cached is None:
        folder = data_dir()
        loaded = {key: json.loads((folder / name).read_text(encoding="utf-8")) for key, name in FILES.items()}
        _cached = Tables(**loaded)
    return _cached
