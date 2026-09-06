"""Where Ksav keeps its files, including when it is running from a USB stick.

There are two modes.

**Installed.** Everything Ksav writes lives under %LOCALAPPDATA%\\Ksav, so it can
be backed up, moved or deleted in one go.

**Portable.** When a file named ``ksav-portable.txt`` sits next to the program,
the data root moves to a ``KsavData`` folder beside it instead. Copy the whole
folder to a USB stick and Ksav runs on any Windows computer with nothing
installed, carrying its models, settings and dictionary with it. Nothing is
written to the host machine.

Portable mode falls back to the normal location if the stick turns out to be
read only, because a write protected drive should slow the program down, not
stop it from opening.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

APP_NAME = "Ksav"
PORTABLE_MARKER = "ksav-portable.txt"
PORTABLE_FOLDER = "KsavData"


def app_dir() -> Path:
    """The folder the program itself is sitting in.

    Under PyInstaller that is the folder holding Ksav.exe, which is what a user
    sees on the USB stick. In development it is the repository folder.
    """
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def bundle_root() -> Path:
    """The folder holding read only resources that ship with the application.

    Under PyInstaller that is the unpacked bundle, which is not the same place as
    :func:`app_dir` in a one file build. Vendored binaries (ffmpeg, tesseract)
    and the seed lexicon are read from here, never written to.
    """
    frozen = getattr(sys, "_MEIPASS", None)
    if frozen:
        return Path(frozen)
    return Path(__file__).resolve().parents[2]


def _is_writable(directory: Path) -> bool:
    """Actually try to write. A read only USB stick reports nothing useful otherwise."""
    try:
        directory.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=str(directory), prefix=".ksav-", delete=True):
            return True
    except OSError:
        return False


def portable_marker() -> Path:
    return app_dir() / PORTABLE_MARKER


def is_portable() -> bool:
    """True when the marker file is present and the folder beside it is writable."""
    if os.environ.get("KSAV_DATA_DIR"):
        return False
    if not portable_marker().is_file():
        return False
    return _is_writable(app_dir() / PORTABLE_FOLDER)


def portable_requested_but_unavailable() -> bool:
    """The marker is there but the drive will not take a write.

    Worth telling the user about plainly, because the symptom otherwise is a
    stick full of models that the program appears to ignore.
    """
    if os.environ.get("KSAV_DATA_DIR"):
        return False
    return portable_marker().is_file() and not _is_writable(app_dir() / PORTABLE_FOLDER)


def _data_root() -> Path:
    override = os.environ.get("KSAV_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    if is_portable():
        return (app_dir() / PORTABLE_FOLDER).resolve()
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return Path(base) / APP_NAME
    base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return Path(base) / APP_NAME.lower()


def data_root() -> Path:
    """Resolved fresh each call, so a test or a portable stick is picked up."""
    return _data_root()


def settings_file() -> Path:
    return data_root() / "settings.json"


def lexicon_db() -> Path:
    return data_root() / "lexicon.sqlite"


def models_dir() -> Path:
    return data_root() / "models"


def jobs_dir() -> Path:
    return data_root() / "jobs"


def logs_dir() -> Path:
    return data_root() / "logs"


def cache_dir() -> Path:
    return data_root() / "cache"


# Deliberately no module level DATA_ROOT constant. One existed and it was a
# trap: resolved at import, it could not follow a portable stick, so logs and
# settings were still written to the host computer while everything else moved.
# Call the functions above.

VENDOR_DIR = bundle_root() / "packaging" / "vendor"


def ensure_dirs() -> None:
    """Create the writable directories. Safe to call repeatedly."""
    for path in (data_root(), models_dir(), jobs_dir(), logs_dir(), cache_dir()):
        path.mkdir(parents=True, exist_ok=True)


def describe_location() -> str:
    """A sentence for the Settings screen saying where things are being kept."""
    if os.environ.get("KSAV_DATA_DIR"):
        return f"A custom folder: {data_root()}"
    if is_portable():
        return f"Portable, on this drive: {data_root()}"
    return f"On this computer: {data_root()}"
