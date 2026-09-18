"""Fail the build if Ksav cannot read a Hebrew page.

The OCR tests skip themselves when Hebrew language data is missing. That means a
build could ship with no Hebrew page reading at all and every test would still
pass, by not running. On the part of Ksav whose whole point is reading seforim,
that silence is the wrong default.

Run in CI before the tests. Also useful by hand when OCR is behaving oddly:

    python packaging/check-tesseract.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ocr.tesseract_engine import TesseractEngine      # noqa: E402

REQUIRED = ("heb", "eng")


def main() -> int:
    engine = TesseractEngine()
    usable, reason = engine.is_available()
    languages = sorted(engine.languages())

    print(f"binary   : {engine.binary()}")
    print(f"usable   : {usable} - {reason}")
    print(f"languages: {', '.join(languages) or 'none'}")

    if not usable:
        print("\nKsav cannot use Tesseract here, so it would ship unable to read a page.")
        return 1

    missing = [name for name in REQUIRED if name not in languages]
    if missing:
        print(f"\n{', '.join(missing)} language data is missing. Ksav would ship")
        print("without it and the page reading tests would skip themselves rather")
        print("than fail, which is how this goes unnoticed.")
        return 1

    print("\nHebrew and English page reading are both present.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
