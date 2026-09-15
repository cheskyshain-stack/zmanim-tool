"""Build the folder you copy to a USB stick.

Run this once on a computer that has internet. It produces a single folder
holding Ksav and the models you chose. Copy that folder to a USB stick, plug the
stick into the offline computer, and either run Ksav straight off the stick or
install it. Either way the offline computer never needs a network connection.

    python packaging/make-usb-bundle.py --models whisper-medium --out D:\\

Produces:

    KsavUSB/
        START HERE.txt        plain instructions for whoever carries the stick
        Ksav/                 the program, ready to run from the stick
            Ksav.exe
            ksav-portable.txt marks it portable, so it keeps its files here
        Models/
            whisper-medium/   the speech model

This deliberately reuses ModelManager.download_to rather than fetching files its
own way, so there is one download implementation and it cannot drift from the
one inside the application.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core import paths                                    # noqa: E402
from app.platform.models import BY_ID, CATALOGUE, ModelManager  # noqa: E402

BUNDLE_NAME = "KsavUSB"

START_HERE = """Ksav on a USB stick
===================

Everything Ksav needs is in this folder. The computer you plug this into does
not need an internet connection.

TO RUN IT WITHOUT INSTALLING
----------------------------
1. Open the Ksav folder.
2. Double click Ksav.

That is all. Ksav runs from the stick and keeps its settings, dictionary and
models on the stick, so nothing is left behind on the computer you used.

TO INSTALL IT PROPERLY
----------------------
1. Double click the setup file in this folder, if there is one.
2. Open Ksav from the Start Menu.
3. The first time it opens it will notice this stick and offer to copy the
   models across. Say yes.

WHAT IS IN HERE
---------------
{contents}

Total size: {size}

PRIVACY
-------
Ksav does all its work on the computer it is running on. Recordings, photos,
documents and text never leave it. Once the models in this folder are in place,
Ksav never needs the internet again.
"""


def human(size: int) -> str:
    gb = size / (1024 ** 3)
    if gb >= 1:
        return f"{gb:.1f} GB"
    return f"{size / (1024 ** 2):.0f} MB"


def folder_size(path: Path) -> int:
    if not path.is_dir():
        return 0
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())


def copy_program(bundle: Path) -> str | None:
    """Copy a built application into the bundle and mark it portable."""
    built = ROOT / "dist" / "Ksav"
    if not built.is_dir():
        return None

    target = bundle / "Ksav"
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(built, target)

    # The marker that switches Ksav to portable mode. Its contents are for the
    # person reading it; only the file name matters to the program.
    (target / paths.PORTABLE_MARKER).write_text(
        "This file tells Ksav to keep its settings, dictionary and models in the\n"
        "KsavData folder beside it, rather than on the computer it is plugged into.\n"
        "Delete it if you would rather Ksav used the computer's own folders.\n",
        encoding="utf-8",
    )
    return "Ksav"


def copy_installer(bundle: Path) -> str | None:
    candidates = sorted((ROOT / "dist").glob("Ksav-Setup-*.exe")) if (ROOT / "dist").is_dir() else []
    if not candidates:
        return None
    installer = candidates[-1]
    shutil.copy2(installer, bundle / installer.name)
    return installer.name


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build a USB bundle of Ksav and its models.",
    )
    parser.add_argument(
        "--models",
        nargs="+",
        default=["whisper-medium"],
        help="Model ids to include. Use --list to see them.",
    )
    parser.add_argument("--out", default=".", help="Where to write the bundle folder.")
    parser.add_argument("--list", action="store_true", help="List available models and exit.")
    args = parser.parse_args()

    if args.list:
        print("Available models:\n")
        for spec in CATALOGUE:
            print(f"  {spec.id:<24} {spec.size_label:>8}  {spec.licence:<11} {spec.name}")
        print("\nMost machines want whisper-medium. A computer with an NVIDIA")
        print("graphics card can take whisper-large-v3.")
        return 0

    unknown = [m for m in args.models if m not in BY_ID]
    if unknown:
        print(f"Unknown model: {', '.join(unknown)}", file=sys.stderr)
        print(f"Known: {', '.join(BY_ID)}", file=sys.stderr)
        return 2

    bundle = Path(args.out).expanduser().resolve() / BUNDLE_NAME
    bundle.mkdir(parents=True, exist_ok=True)
    models_dir = bundle / "Models"
    models_dir.mkdir(exist_ok=True)

    manager = ModelManager(models_dir)
    contents: list[str] = []

    program = copy_program(bundle)
    if program:
        contents.append(f"  Ksav\\              the program, runs straight off the stick")
    else:
        print("Note: no built application found in dist/Ksav.")
        print("      Run 'pyinstaller packaging/ksav.spec' first to include the program.")
        print("      Building the models only.\n")

    installer = copy_installer(bundle)
    if installer:
        contents.append(f"  {installer}   the installer, if you would rather install it")

    for model_id in args.models:
        spec = BY_ID[model_id]
        target = models_dir / spec.id
        if manager.looks_like(spec, target):
            print(f"{spec.name}: already in the bundle, skipping.")
        else:
            print(f"{spec.name}: downloading {spec.size_label} ...")

            state = {"line": ""}

            def show(name: str, fraction: float, index: int, total: int) -> None:
                overall = (index + fraction) / max(1, total)
                line = f"  [{'=' * int(overall * 30):<30}] {overall * 100:5.1f}%  {name}"
                if line != state["line"]:
                    print(line, end="\r", flush=True)
                    state["line"] = line

            try:
                manager.download_to(spec, target, on_progress=show)
            except KeyboardInterrupt:
                print("\n\nStopped. Run the same command again to carry on where it left off.")
                return 1
            print()
        contents.append(f"  Models\\{spec.id}\\   {spec.name} ({spec.size_label})")

    total = folder_size(bundle)
    (bundle / "START HERE.txt").write_text(
        START_HERE.format(contents="\n".join(contents), size=human(total)),
        encoding="utf-8",
    )

    print(f"\nDone. {human(total)} in {bundle}")
    print("Copy that whole folder to a USB stick.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
