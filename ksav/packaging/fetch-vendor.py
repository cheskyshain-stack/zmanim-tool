"""Gather the binaries that ship inside Ksav.

Run once before building the installer. It puts Tesseract and its language data
under packaging/vendor/tesseract, which the PyInstaller spec then bundles.

    python packaging/fetch-vendor.py

Everything it fetches is Apache-2.0. It deliberately does not fetch ffmpeg:
PyAV already carries FFmpeg's libraries, built under the LGPL, so there is no
separate binary and no chance of picking up a GPL build by mistake.

Speech models are not fetched here. They install from the Model Vault or from a
USB stick, which keeps the installer small enough to send to somebody.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.platform import net                     # noqa: E402
from app.platform.models import TESSDATA         # noqa: E402

VENDOR = ROOT / "packaging" / "vendor"
TESSERACT_DIR = VENDOR / "tesseract"

# Where Tesseract usually lands on Windows, and where a package manager on a
# build machine puts it.
CANDIDATES = [
    Path(r"C:\Program Files\Tesseract-OCR"),
    Path(r"C:\Program Files (x86)\Tesseract-OCR"),
    Path(r"C:\tools\tesseract"),
    Path("/usr/share/tesseract-ocr/5"),
    Path("/usr/share/tesseract-ocr/4.00"),
]

# The languages that ship with Ksav. Everything else installs from the vault.
LANGUAGES = ["heb", "eng", "osd", "yid"]


def holds_program(folder: Path) -> bool:
    """Whether this folder holds the Tesseract program, not just its data.

    Worth checking: /usr/share/tesseract-ocr/5 holds only tessdata, so copying
    it produced an empty vendor folder and said nothing about it.
    """
    return any((folder / name).is_file()
               for name in ("tesseract.exe", "tesseract"))


def is_self_contained(folder: Path) -> bool:
    """Whether this folder is Tesseract's own, rather than a shared system bin.

    This matters more than it looks. On Linux the program lives in /usr/bin
    alongside every other program on the machine, and copying "the folder
    Tesseract is in" tried to vendor the entire operating system before it ran
    out of disk. A real Tesseract installation, which is what Windows has, sits
    in its own directory with its libraries and tessdata beside it.
    """
    if not holds_program(folder):
        return False
    if folder.name.lower() in ("bin", "sbin", "usr", "local"):
        return False
    has_libraries = any(folder.glob("*.dll")) or any(folder.glob("*.so*"))
    return has_libraries or (folder / "tessdata").is_dir()


def find_tesseract() -> Path | None:
    """A self contained Tesseract installation to copy, or None."""
    binary = shutil.which("tesseract")
    if binary:
        folder = Path(binary).resolve().parent
        if is_self_contained(folder):
            return folder
    for candidate in CANDIDATES:
        if candidate.is_dir() and is_self_contained(candidate):
            return candidate
    return None


def copy_tesseract(source: Path) -> None:
    """Copy the program and its libraries, but not its language data.

    The shipped languages are downloaded fresh below, from tessdata_best, which
    is slower and noticeably better on Hebrew print than whatever the system
    copy happens to carry.
    """
    TESSERACT_DIR.mkdir(parents=True, exist_ok=True)
    copied = 0
    for item in source.iterdir():
        if item.name == "tessdata":
            continue
        target = TESSERACT_DIR / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, target)
        copied += 1
    print(f"  copied {copied} items from {source}")

    if not holds_program(TESSERACT_DIR):
        print("  WARNING: no tesseract program was copied. Ksav will fall back to")
        print("  a Tesseract on the PATH, which a normal installation will not have.")


def fetch_languages() -> None:
    tessdata = TESSERACT_DIR / "tessdata"
    tessdata.mkdir(parents=True, exist_ok=True)

    with net.gate("fetch Tesseract language data for the installer"):
        net.allow_downloads_env()
        for language in LANGUAGES:
            target = tessdata / f"{language}.traineddata"
            if target.is_file() and target.stat().st_size > 0:
                print(f"  {language}: already here")
                continue
            print(f"  {language}: downloading ...", end="", flush=True)
            try:
                net.download(f"{TESSDATA}/{language}.traineddata", target)
                print(f" {target.stat().st_size // 1024} KB")
            except Exception as exc:
                print(f" failed: {exc}")
    net.enforce_offline_env()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tesseract", help="Folder holding tesseract, if it is "
                                            "somewhere unusual.")
    parser.add_argument("--languages-only", action="store_true",
                        help="Only fetch language data, do not copy the program.")
    args = parser.parse_args()

    VENDOR.mkdir(parents=True, exist_ok=True)

    if not args.languages_only:
        source = Path(args.tesseract) if args.tesseract else find_tesseract()
        if source is not None and not is_self_contained(source):
            print(f"{source} is not a self contained Tesseract installation.")
            source = None
        if source is None:
            print("No self contained Tesseract installation was found.")
            print()
            print("This step is for building the Windows installer, where Tesseract")
            print("lives in its own folder with its libraries beside it. On Linux it")
            print("is spread across the system and there is nothing sensible to")
            print("vendor, so run this on Windows:")
            print("  choco install tesseract")
            print()
            print("Fetching the language data anyway, which is useful either way.")
            fetch_languages()
            return 1
        print(f"Tesseract from {source}")
        copy_tesseract(source)

    print("Language data:")
    fetch_languages()

    total = sum(p.stat().st_size for p in TESSERACT_DIR.rglob("*") if p.is_file())
    print(f"\nVendored {total / (1024 ** 2):.0f} MB into {TESSERACT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
