"""Build Ksav, in one command.

    python packaging/build.py

Produces dist/Ksav (the program) and, on Windows with Inno Setup installed,
dist/Ksav-Setup-<version>.exe (the installer a person double clicks).

This must run on Windows to produce a Windows build. PyInstaller does not cross
compile: it freezes the interpreter it is running under, for the platform it is
running on. Running it on Linux produces a Linux build, which is useful for
checking the spec and useless for shipping.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "0.1.0"


def run(command: list[str], **kwargs) -> int:
    print(f"\n$ {' '.join(command)}\n", flush=True)
    return subprocess.call(command, cwd=str(ROOT), **kwargs)


def find_inno() -> Path | None:
    found = shutil.which("iscc")
    if found:
        return Path(found)
    for candidate in (
        Path(r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"),
        Path(r"C:\Program Files\Inno Setup 6\ISCC.exe"),
    ):
        if candidate.is_file():
            return candidate
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-vendor", action="store_true",
                        help="Do not fetch Tesseract; use what is already vendored.")
    parser.add_argument("--skip-installer", action="store_true",
                        help="Build the program only, not the installer.")
    parser.add_argument("--skip-tests", action="store_true")
    args = parser.parse_args()

    if sys.platform != "win32":
        print("Note: this is not Windows, so the result will not run on Windows.")
        print("PyInstaller freezes for the platform it runs on; it does not cross")
        print("compile. This build is still worth doing to check the spec.\n")

    if not args.skip_tests:
        print("Running the tests first, because shipping a red build helps nobody.")
        if run([sys.executable, "-m", "pytest", "tests", "-q"]) != 0:
            print("\nTests failed. Fix them, or pass --skip-tests if you meant to.")
            return 1

    if not args.skip_vendor:
        if run([sys.executable, "packaging/fetch-vendor.py"]) != 0:
            print("\nCould not gather Tesseract. Ksav will build without it and fall")
            print("back to a Tesseract on the PATH at run time.")

    for folder in ("build", "dist"):
        shutil.rmtree(ROOT / folder, ignore_errors=True)

    if run([sys.executable, "-m", "PyInstaller",
            "packaging/ksav.spec", "--noconfirm"]) != 0:
        print("\nThe build failed.")
        return 1

    built = ROOT / "dist" / "Ksav"
    size = sum(p.stat().st_size for p in built.rglob("*") if p.is_file())
    print(f"\nBuilt {built} ({size / (1024 ** 2):.0f} MB)")

    if args.skip_installer:
        return 0

    if sys.platform != "win32":
        print("Skipping the installer: Inno Setup is Windows only.")
        return 0

    inno = find_inno()
    if inno is None:
        print("\nInno Setup was not found, so no installer was built.")
        print("Install it from https://jrsoftware.org/isdl.php, or:")
        print("  choco install innosetup")
        return 0

    if run([str(inno), str(ROOT / "packaging" / "installer.iss")]) != 0:
        print("\nThe installer step failed.")
        return 1

    installer = ROOT / "dist" / f"Ksav-Setup-{VERSION}.exe"
    if installer.is_file():
        print(f"\nInstaller: {installer} "
              f"({installer.stat().st_size / (1024 ** 2):.0f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
