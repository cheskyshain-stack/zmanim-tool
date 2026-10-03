"""The only module in Ksav that is allowed to open a socket.

Everything else in the application imports nothing network capable, and
``tests/test_no_network.py`` fails the build if that stops being true. This is
the mechanism behind the privacy promise: it does not rest on nobody having made
a mistake, it rests on a test.

The gate is closed by default. A download only happens when the Model Vault
opens it for the duration of one explicit, user initiated transfer.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator

from ..core.logging import get

log = get(__name__)

USER_AGENT = "Ksav/0.1 (offline desktop app)"
CHUNK = 1024 * 256


class NetworkBlocked(RuntimeError):
    """Raised when something tries to transfer while the gate is closed."""


class _Gate:
    """Closed unless a caller has explicitly opened it.

    Deliberately not a boolean flag on a module: opening it is a context manager
    so the gate cannot be left open by an early return or an exception.
    """

    def __init__(self) -> None:
        self._depth = 0
        self._reason = ""

    @property
    def open(self) -> bool:
        return self._depth > 0

    @property
    def reason(self) -> str:
        return self._reason

    def __call__(self, reason: str):
        return _GateContext(self, reason)

    def check(self) -> None:
        if not self._depth:
            raise NetworkBlocked(
                "Ksav does not make network requests except for an explicit "
                "model download. Nothing has opened the network gate."
            )


class _GateContext:
    def __init__(self, gate: _Gate, reason: str) -> None:
        self._gate = gate
        self._reason = reason

    def __enter__(self) -> _Gate:
        self._gate._depth += 1
        self._gate._reason = self._reason
        log.info("network gate opened: %s", self._reason)
        return self._gate

    def __exit__(self, *exc) -> None:
        self._gate._depth -= 1
        if not self._gate._depth:
            self._gate._reason = ""
            log.info("network gate closed")


gate = _Gate()


def enforce_offline_env() -> None:
    """Stop inference libraries reaching for a missing file on their own.

    Several machine learning libraries will quietly download a model or a
    tokenizer when they cannot find one locally. These variables turn that into
    a clear error instead of a silent transfer.
    """
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")
    os.environ.setdefault("DO_NOT_TRACK", "1")


def allow_downloads_env() -> None:
    """Lift the offline pin for the duration of a deliberate download."""
    os.environ["HF_HUB_OFFLINE"] = "0"
    os.environ["TRANSFORMERS_OFFLINE"] = "0"


@dataclass
class Progress:
    downloaded: int
    total: int | None
    path: str

    @property
    def fraction(self) -> float | None:
        if not self.total:
            return None
        return min(1.0, self.downloaded / self.total)


ProgressFn = Callable[[Progress], None]


def _open(url: str, start: int = 0):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    if start:
        request.add_header("Range", f"bytes={start}-")
    return urllib.request.urlopen(request, timeout=60)


def download(
    url: str,
    destination: Path,
    *,
    sha256: str | None = None,
    expected_size: int | None = None,
    on_progress: ProgressFn | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> Path:
    """Fetch one file, resumably, verifying it before it is put in place.

    The transfer goes to ``<destination>.part`` so an interrupted download never
    leaves a truncated file that looks complete. A restart continues from the
    bytes already on disk when the server supports ranges.
    """
    gate.check()
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    part = destination.with_suffix(destination.suffix + ".part")

    start = part.stat().st_size if part.exists() else 0
    mode = "ab" if start else "wb"

    try:
        response = _open(url, start)
    except urllib.error.HTTPError as exc:
        if start and exc.code in (416, 200):
            # Server will not resume. Start over rather than corrupt the file.
            part.unlink(missing_ok=True)
            start, mode = 0, "wb"
            response = _open(url, 0)
        else:
            raise

    with response:
        if start and response.status == 200:
            # Range ignored: the body is the whole file, so restart cleanly.
            part.unlink(missing_ok=True)
            start, mode = 0, "wb"
        length = response.headers.get("Content-Length")
        total = (int(length) + start) if length else expected_size

        with open(part, mode) as fh:
            downloaded = start
            while True:
                if should_cancel and should_cancel():
                    raise InterruptedError("download cancelled")
                block = response.read(CHUNK)
                if not block:
                    break
                fh.write(block)
                downloaded += len(block)
                if on_progress:
                    on_progress(Progress(downloaded, total, str(destination)))

    if sha256:
        actual = file_sha256(part)
        if actual.lower() != sha256.lower():
            part.unlink(missing_ok=True)
            raise ValueError(
                f"Checksum mismatch for {destination.name}. "
                f"Expected {sha256[:12]}, got {actual[:12]}. The file was discarded."
            )

    os.replace(part, destination)
    log.info("downloaded %s (%s bytes)", destination.name, destination.stat().st_size)
    return destination


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def copy_local(source: Path, destination: Path, on_progress: ProgressFn | None = None) -> Path:
    """Import a model from a folder or a USB stick, with no network at all.

    This is the path for a machine that has never been online. It is here rather
    than in the downloader because it is the same operation from the user's point
    of view and should look identical in the Model Vault.
    """
    source, destination = Path(source), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    total = source.stat().st_size
    with open(source, "rb") as src, tempfile.NamedTemporaryFile(
        delete=False, dir=str(destination.parent)
    ) as dst:
        copied = 0
        while True:
            block = src.read(CHUNK)
            if not block:
                break
            dst.write(block)
            copied += len(block)
            if on_progress:
                on_progress(Progress(copied, total, str(destination)))
        tmp_name = dst.name
    os.replace(tmp_name, destination)
    return destination


def copy_tree(source: Path, destination: Path) -> Path:
    """Import a whole model folder from local media."""
    source, destination = Path(source), Path(destination)
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(source, destination)
    return destination
