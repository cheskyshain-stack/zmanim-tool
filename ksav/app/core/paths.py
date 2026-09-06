"""Where Ksav keeps its files.

Everything Ksav writes lives under one root so that a user can back it up, move
it to another machine, or delete it, without hunting through the filesystem.
On Windows that root is %LOCALAPPDATA%\\Ksav. Elsewhere (development machines)
it follows the XDG convention, so the app is runnable on Linux for testing.

Nothing here creates a directory until something actually needs to write to it.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "Ksav"


def _data_root() -> Path:
    override = os.environ.get("KSAV_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return Path(base) / APP_NAME
    base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return Path(base) / APP_NAME.lower()


DATA_ROOT = _data_root()

SETTINGS_FILE = DATA_ROOT / "settings.json"
LEXICON_DB = DATA_ROOT / "lexicon.sqlite"
MODELS_DIR = DATA_ROOT / "models"
JOBS_DIR = DATA_ROOT / "jobs"
LOGS_DIR = DATA_ROOT / "logs"
CACHE_DIR = DATA_ROOT / "cache"


def bundle_root() -> Path:
    """The folder holding read-only resources that ship with the application.

    Under PyInstaller that is the unpacked bundle; in development it is the
    repository's ``ksav`` folder. Vendored binaries (ffmpeg, tesseract) and the
    seed lexicon are read from here, never written to.
    """
    frozen = getattr(sys, "_MEIPASS", None)
    if frozen:
        return Path(frozen)
    return Path(__file__).resolve().parents[2]


VENDOR_DIR = bundle_root() / "packaging" / "vendor"


def ensure_dirs() -> None:
    """Create the writable directories. Safe to call repeatedly."""
    for path in (DATA_ROOT, MODELS_DIR, JOBS_DIR, LOGS_DIR, CACHE_DIR):
        path.mkdir(parents=True, exist_ok=True)
