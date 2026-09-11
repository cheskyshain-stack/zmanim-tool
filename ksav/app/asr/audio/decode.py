"""Reading audio files, without shelling out to a separate ffmpeg binary.

PyAV wheels bundle FFmpeg's libraries directly, built under the LGPL. That is
better than vendoring an ffmpeg.exe for two reasons: there is no separate binary
to ship and keep on the PATH, and it removes the risk of accidentally bundling
a GPL ffmpeg build, which would pull the whole application under the GPL. The
licensing note in docs/licensing.md was updated when this became the approach.

The command line ffmpeg is still used as a fallback if it happens to be present,
because a corrupt or unusual file that PyAV refuses will sometimes open there.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from ...core.logging import get

log = get(__name__)

# What the brief asked for, plus the ones that turn up anyway.
SUPPORTED_EXTENSIONS = (
    "mp3", "wav", "m4a", "mp4", "aac", "flac",
    "ogg", "opus", "wma", "webm", "amr", "3gp", "mkv", "mov", "aiff",
)

_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


class AudioError(RuntimeError):
    """A file that cannot be read. The message is shown to the user verbatim."""


@dataclass
class AudioInfo:
    path: str
    duration: float
    sample_rate: int = 0
    channels: int = 0
    codec: str = ""
    container: str = ""

    @property
    def duration_label(self) -> str:
        seconds = int(self.duration)
        hours, rest = divmod(seconds, 3600)
        minutes, secs = divmod(rest, 60)
        if hours:
            return f"{hours}h {minutes:02d}m"
        if minutes:
            return f"{minutes}m {secs:02d}s"
        return f"{secs}s"


def is_supported(path: Path | str) -> bool:
    return Path(path).suffix.lower().lstrip(".") in SUPPORTED_EXTENSIONS


def probe(path: Path | str) -> AudioInfo:
    """Duration and format, needed before transcription so progress means something.

    A job that cannot say how long the recording is can only show a spinner, and
    on a three hour shiur a spinner is not an answer.
    """
    path = Path(path)
    if not path.is_file():
        raise AudioError(f"{path.name} could not be found.")

    info = _probe_pyav(path)
    if info is not None:
        return info

    info = _probe_ffprobe(path)
    if info is not None:
        return info

    raise AudioError(
        f"{path.name} could not be opened as audio. It may be corrupt, or in a "
        f"format Ksav does not handle."
    )


def _probe_pyav(path: Path) -> AudioInfo | None:
    try:
        import av
    except ImportError:
        return None

    try:
        with av.open(str(path)) as container:
            streams = [s for s in container.streams if s.type == "audio"]
            if not streams:
                raise AudioError(f"{path.name} has no audio in it.")
            stream = streams[0]

            duration = 0.0
            if container.duration:
                duration = container.duration / 1_000_000
            elif stream.duration and stream.time_base:
                duration = float(stream.duration * stream.time_base)

            return AudioInfo(
                path=str(path),
                duration=round(duration, 2),
                sample_rate=getattr(stream, "rate", 0) or 0,
                channels=getattr(stream, "channels", 0) or 0,
                codec=stream.codec_context.name if stream.codec_context else "",
                container=container.format.name if container.format else "",
            )
    except AudioError:
        raise
    except Exception as exc:
        log.info("PyAV could not open %s: %s", path.name, exc)
        return None


def _probe_ffprobe(path: Path) -> AudioInfo | None:
    exe = shutil.which("ffprobe")
    if not exe:
        return None
    try:
        result = subprocess.run(
            [exe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=30, creationflags=_NO_WINDOW,
        )
        if result.returncode != 0:
            return None
        return AudioInfo(path=str(path), duration=round(float(result.stdout.strip()), 2))
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def to_wav(source: Path | str, destination: Path | str, sample_rate: int = 16000) -> Path:
    """Convert to 16 kHz mono WAV.

    Only needed when something downstream cannot read the original. The
    recognition engine reads most formats directly, so this is not on the normal
    path and does not cost a copy of every recording.
    """
    source, destination = Path(source), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)

    try:
        import av
    except ImportError as exc:
        raise AudioError("Audio conversion needs the PyAV package.") from exc

    try:
        with av.open(str(source)) as inp, av.open(str(destination), "w") as out:
            in_stream = next(s for s in inp.streams if s.type == "audio")
            out_stream = out.add_stream("pcm_s16le", rate=sample_rate)
            out_stream.layout = "mono"
            for frame in inp.decode(in_stream):
                frame.pts = None
                for packet in out_stream.encode(frame):
                    out.mux(packet)
            for packet in out_stream.encode(None):
                out.mux(packet)
    except Exception as exc:
        raise AudioError(f"{source.name} could not be converted: {exc}") from exc
    return destination
