"""Finding the USB stick.

The point of this module is that a user should never have to know where they put
something. They copy a folder to a stick, plug it into the offline computer, and
Ksav finds it. Hunting through a file dialog is the fallback, not the path.

Everything here is filesystem inspection. Nothing is mounted, ejected or
modified, and no drive outside the ones the user has attached is touched.
"""

from __future__ import annotations

import ctypes
import string
import sys
from pathlib import Path

from ..core import paths
from ..core.logging import get

log = get(__name__)

DRIVE_REMOVABLE = 2
DRIVE_FIXED = 3

# The folder name the bundle builder writes, checked at every candidate root.
BUNDLE_FOLDER = "Models"
BUNDLE_ROOT = "KsavUSB"


def removable_drives() -> list[Path]:
    """Drive letters Windows reports as removable.

    Returns an empty list off Windows, which is correct rather than a failure:
    there is nothing to enumerate.
    """
    if sys.platform != "win32":
        return []
    try:
        kernel32 = ctypes.windll.kernel32
        mask = kernel32.GetLogicalDrives()
    except (AttributeError, OSError) as exc:
        log.warning("could not enumerate drives: %s", exc)
        return []

    found: list[Path] = []
    for index, letter in enumerate(string.ascii_uppercase):
        if not (mask >> index) & 1:
            continue
        root = f"{letter}:\\"
        try:
            if kernel32.GetDriveTypeW(ctypes.c_wchar_p(root)) == DRIVE_REMOVABLE:
                found.append(Path(root))
        except OSError:
            continue
    return found


def candidate_model_roots() -> list[Path]:
    """Every folder worth checking for models the user copied across.

    Ordered by how likely it is to be the right one, so the first hit is
    normally the answer. Duplicates and folders that do not exist are dropped.
    """
    here = paths.app_dir()
    candidates: list[Path] = [
        # Beside the program: the portable layout, and the installer sitting on
        # the stick next to its models.
        here / BUNDLE_FOLDER,
        here.parent / BUNDLE_FOLDER,
        here / BUNDLE_ROOT / BUNDLE_FOLDER,
        here.parent / BUNDLE_ROOT / BUNDLE_FOLDER,
        # A stick where the models were copied to the root.
        here,
    ]
    for drive in removable_drives():
        candidates.extend([
            drive / BUNDLE_ROOT / BUNDLE_FOLDER,
            drive / BUNDLE_FOLDER,
            drive / BUNDLE_ROOT,
            drive,
        ])

    seen: set[str] = set()
    out: list[Path] = []
    for candidate in candidates:
        try:
            if not candidate.is_dir():
                continue
            key = str(candidate.resolve()).lower()
        except OSError:
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(candidate)
    return out


def source_folder(path: Path) -> Path:
    """The folder a user would say the model came from.

    Given ``E:/KsavUSB/Models/whisper-medium`` a user does not think "the
    whisper-medium folder", they think "the stick". Walk up past the model's own
    folder and past ``Models`` so the interface names the thing they carried.
    """
    path = Path(path)
    if path.parent.name == BUNDLE_FOLDER:
        path = path.parent
    if path.name == BUNDLE_FOLDER:
        path = path.parent
    return path


def describe(path: Path) -> str:
    """How to name a found location in the interface, from the user's point of view.

    A removable drive is named as one, because that is what the user plugged in.
    Anything else is shortened to the last couple of folders: the full path is
    accurate but unreadable in a sentence, and belongs in a tooltip.
    """
    folder = source_folder(path)
    try:
        resolved = folder.resolve()
    except OSError:
        resolved = folder

    for drive in removable_drives():
        try:
            resolved.relative_to(drive.resolve())
        except (ValueError, OSError):
            continue
        return f"the USB drive {str(drive).rstrip(chr(92)).rstrip('/')}"

    if paths.is_portable():
        try:
            resolved.relative_to(paths.app_dir().resolve())
            return "this drive"
        except (ValueError, OSError):
            pass

    parts = resolved.parts
    if len(parts) > 2:
        return str(Path(*parts[-2:]))
    return str(resolved)


def describe_full(path: Path) -> str:
    """The exact location, for a tooltip where precision beats readability."""
    try:
        return str(source_folder(path).resolve())
    except OSError:
        return str(source_folder(path))
