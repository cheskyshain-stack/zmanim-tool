"""Getting audio off the microphone.

Wrapped behind an interface for two reasons. Tests need to drive dictation with
a known signal rather than a real microphone, and sounddevice needs PortAudio,
which is not present on every machine. A missing microphone should disable
dictation with a clear sentence, not stop the application from opening.
"""

from __future__ import annotations

import abc
import queue
import threading
from dataclasses import dataclass
from typing import Callable

import numpy as np

from ...core.logging import get
from .vad import FRAME_SAMPLES, SAMPLE_RATE

log = get(__name__)

FrameFn = Callable[[np.ndarray], None]


@dataclass
class Device:
    index: int
    name: str
    channels: int
    default: bool = False

    def __str__(self) -> str:
        return f"{self.name}{' (default)' if self.default else ''}"


class AudioSource(abc.ABC):
    """Somewhere frames come from."""

    @abc.abstractmethod
    def start(self, on_frame: FrameFn) -> None:
        ...

    @abc.abstractmethod
    def stop(self) -> None:
        ...

    @property
    def level(self) -> float:
        """Loudness of the most recent frame, 0 to 1, for the meter."""
        return 0.0


def available() -> tuple[bool, str]:
    """Whether a microphone can be used, and why not when it cannot."""
    try:
        import sounddevice
    except ImportError:
        return False, (
            "Dictation needs the sounddevice package, which is not installed."
        )
    except OSError as exc:
        return False, (
            f"The system audio libraries could not be loaded, so the microphone "
            f"is unavailable. ({exc})"
        )
    try:
        devices = sounddevice.query_devices()
    except Exception as exc:
        return False, f"No microphone could be found. ({exc})"

    inputs = [d for d in devices if d.get("max_input_channels", 0) > 0]
    if not inputs:
        return False, "No microphone is connected to this computer."
    return True, f"{len(inputs)} microphone{'s' if len(inputs) != 1 else ''} found."


def list_devices() -> list[Device]:
    """Every microphone, for the Settings screen. Empty when there are none."""
    try:
        import sounddevice

        devices = sounddevice.query_devices()
        try:
            default_index = sounddevice.default.device[0]
        except Exception:
            default_index = None
    except Exception as exc:
        log.info("could not list microphones: %s", exc)
        return []

    out = []
    for index, device in enumerate(devices):
        if device.get("max_input_channels", 0) <= 0:
            continue
        out.append(Device(
            index=index,
            name=device.get("name", f"Device {index}"),
            channels=device["max_input_channels"],
            default=index == default_index,
        ))
    return out


class MicrophoneSource(AudioSource):
    """A live microphone at 16 kHz mono, in VAD sized frames."""

    def __init__(self, device: int | str | None = None) -> None:
        self._device = device
        self._stream = None
        self._level = 0.0

    @property
    def level(self) -> float:
        return self._level

    def start(self, on_frame: FrameFn) -> None:
        import sounddevice

        def callback(indata, _frames, _time, status):
            if status:
                log.info("audio input status: %s", status)
            frame = np.asarray(indata, dtype=np.float32).reshape(-1)
            self._level = float(np.sqrt(np.mean(np.square(frame)))) if frame.size else 0.0
            on_frame(frame)

        self._stream = sounddevice.InputStream(
            samplerate=SAMPLE_RATE,
            blocksize=FRAME_SAMPLES,
            channels=1,
            dtype="float32",
            device=self._device,
            callback=callback,
        )
        self._stream.start()

    def stop(self) -> None:
        stream, self._stream = self._stream, None
        self._level = 0.0
        if stream is not None:
            try:
                stream.stop()
                stream.close()
            except Exception as exc:
                log.info("closing the microphone raised: %s", exc)


class BufferSource(AudioSource):
    """A fixed signal delivered as frames. Used by the tests.

    Runs on its own thread like a real microphone, so the code under test sees
    the same threading it will see in the application.
    """

    def __init__(self, audio: np.ndarray, realtime: bool = False) -> None:
        self._audio = np.asarray(audio, dtype=np.float32)
        self._realtime = realtime
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._level = 0.0
        self.finished = threading.Event()

    @property
    def level(self) -> float:
        return self._level

    def start(self, on_frame: FrameFn) -> None:
        self._stop.clear()
        self.finished.clear()

        def run() -> None:
            import time

            count = len(self._audio) // FRAME_SAMPLES
            for i in range(count):
                if self._stop.is_set():
                    break
                frame = self._audio[i * FRAME_SAMPLES:(i + 1) * FRAME_SAMPLES]
                self._level = float(np.sqrt(np.mean(np.square(frame))))
                on_frame(frame)
                if self._realtime:
                    time.sleep(FRAME_SAMPLES / SAMPLE_RATE)
            self.finished.set()

        self._thread = threading.Thread(target=run, name="ksav-buffer", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)
        self._level = 0.0
