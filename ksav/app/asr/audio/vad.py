"""Deciding when someone is speaking.

This exists for two reasons. Whisper invents text during silence, confidently
and fluently, so feeding it silence is worse than feeding it nothing. And live
dictation has to know when a phrase has ended, because that is the moment the
text can appear.

Two implementations behind one interface. The energy detector needs no model and
works on any machine, which matters because dictation must not be gated behind a
download. Silero is markedly better in a noisy room and is used when its model
is installed, which happens through the same Model Vault as everything else.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ...core.logging import get

log = get(__name__)

SAMPLE_RATE = 16000
FRAME_MS = 32
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000     # 512 samples, what Silero wants


@dataclass
class VadSettings:
    # How many frames of speech before a phrase is considered started. Two
    # frames is about 60ms, enough to ignore a cough or a keyboard press.
    onset_frames: int = 2
    # How long a pause ends a phrase. Under half a second and it chops people
    # off mid sentence; over a second and dictation feels sluggish.
    hangover_frames: int = 22          # about 0.7 seconds
    # Frames kept from before the onset, so the first consonant is not clipped.
    preroll_frames: int = 8
    # A phrase longer than this is cut anyway, so a long monologue still
    # produces text rather than growing forever.
    max_utterance_seconds: float = 25.0
    # Measured in frames that actually held speech, not in buffer length. The
    # buffer carries preroll and hangover padding, so a 0.1 second cough came
    # out as a one second "utterance" and was let through.
    min_speech_frames: int = 7          # about 0.22 seconds of real speech
    # How much of the trailing pause to keep. The full hangover is not needed
    # and handing Whisper a long tail of silence invites it to invent words.
    keep_tail_frames: int = 6


class Vad(abc.ABC):
    """Frame by frame speech detection."""

    id: str = ""
    name: str = ""

    @abc.abstractmethod
    def is_speech(self, frame: np.ndarray) -> bool:
        """``frame`` is float32 mono at 16 kHz, FRAME_SAMPLES long."""

    def reset(self) -> None:
        """Forget any adaptation. Called when dictation starts."""


class EnergyVad(Vad):
    """Loudness against an adapting noise floor.

    Deliberately not a fixed threshold. A shul, a car and a kitchen have wildly
    different noise floors, and a fixed level either misses quiet speech or
    triggers on a fan. The floor tracks the quietest recent frames, so it settles
    to whatever the room is doing.
    """

    id = "energy"
    name = "Loudness (no model needed)"

    def __init__(self, factor: float = 3.2, floor_history: int = 120) -> None:
        self._factor = factor
        self._history: list[float] = []
        self._history_size = floor_history
        self._floor = 0.0

    def reset(self) -> None:
        self._history.clear()
        self._floor = 0.0

    def is_speech(self, frame: np.ndarray) -> bool:
        rms = float(np.sqrt(np.mean(np.square(frame.astype(np.float32)))))

        self._history.append(rms)
        if len(self._history) > self._history_size:
            self._history.pop(0)

        # The floor is the quiet quarter of what has been heard recently.
        quiet = np.percentile(self._history, 25) if len(self._history) >= 8 else rms
        self._floor = float(quiet)

        # An absolute minimum stops near silent input from triggering on its own
        # noise once the floor adapts down to nothing.
        threshold = max(self._floor * self._factor, 0.005)
        return rms > threshold


class SileroVad(Vad):
    """Silero VAD through ONNX Runtime.

    Better than loudness in a room with other noise in it, because it is
    detecting speech rather than volume. Needs its model, which is small and
    installs through the Model Vault like everything else. Falls back rather
    than failing when the model is not there.
    """

    id = "silero"
    name = "Silero (more accurate in a noisy room)"

    def __init__(self, model_path: Path | str, threshold: float = 0.5) -> None:
        self._path = Path(model_path)
        self._threshold = threshold
        self._session = None
        self._state = np.zeros((2, 1, 128), dtype=np.float32)

    def _load(self):
        if self._session is not None:
            return self._session
        try:
            import onnxruntime
        except ImportError as exc:
            raise RuntimeError(
                "Silero speech detection needs the onnxruntime package."
            ) from exc
        if not self._path.is_file():
            raise RuntimeError(
                f"The Silero model is not installed. Install it from the Model "
                f"Vault, or Ksav will use loudness detection instead."
            )
        options = onnxruntime.SessionOptions()
        options.inter_op_num_threads = 1
        options.intra_op_num_threads = 1
        self._session = onnxruntime.InferenceSession(
            str(self._path), sess_options=options, providers=["CPUExecutionProvider"]
        )
        return self._session

    def reset(self) -> None:
        self._state = np.zeros((2, 1, 128), dtype=np.float32)

    def is_speech(self, frame: np.ndarray) -> bool:
        session = self._load()
        audio = frame.astype(np.float32).reshape(1, -1)
        inputs = {
            "input": audio,
            "state": self._state,
            "sr": np.array(SAMPLE_RATE, dtype=np.int64),
        }
        try:
            probability, self._state = session.run(None, inputs)
        except Exception as exc:
            log.warning("Silero failed on a frame, falling back: %s", exc)
            raise
        return float(probability[0][0]) >= self._threshold


def build(model_path: Path | None = None) -> Vad:
    """Silero when its model is installed, loudness otherwise.

    Never raises: dictation must not be gated behind a download.
    """
    if model_path and Path(model_path).is_file():
        try:
            vad = SileroVad(model_path)
            vad._load()
            log.info("using Silero speech detection")
            return vad
        except Exception as exc:
            log.info("Silero unavailable (%s), using loudness detection", exc)
    return EnergyVad()


@dataclass
class Utterance:
    """One phrase, ready to be transcribed."""

    audio: np.ndarray
    start: float              # seconds since dictation began
    end: float
    reason: str = "pause"     # pause, length or stopped

    @property
    def duration(self) -> float:
        return len(self.audio) / SAMPLE_RATE


class Segmenter:
    """Turns a stream of frames into phrases.

    A state machine rather than anything cleverer, and it is pure: no audio
    device, no threads, no clock. That is what makes it testable, and this is the
    piece where the timing decisions that make dictation feel quick or sluggish
    actually live.
    """

    def __init__(self, vad: Vad, settings: VadSettings | None = None) -> None:
        self.vad = vad
        self.settings = settings or VadSettings()
        self.reset()

    def reset(self) -> None:
        self.vad.reset()
        self._speaking = False
        self._speech_run = 0
        self._silence_run = 0
        self._buffer: list[np.ndarray] = []
        self._preroll: list[np.ndarray] = []
        self._frames_seen = 0
        self._start_frame = 0
        self._speech_frames = 0

    @property
    def speaking(self) -> bool:
        return self._speaking

    def _seconds(self, frames: int) -> float:
        return frames * FRAME_SAMPLES / SAMPLE_RATE

    def push(self, frame: np.ndarray) -> Utterance | None:
        """Feed one frame. Returns a phrase when one has just ended."""
        self._frames_seen += 1
        speech = self.vad.is_speech(frame)

        if not self._speaking:
            self._preroll.append(frame)
            if len(self._preroll) > self.settings.preroll_frames:
                self._preroll.pop(0)

            self._speech_run = self._speech_run + 1 if speech else 0
            if self._speech_run >= self.settings.onset_frames:
                self._speaking = True
                # Keep the frames just before the onset so the first consonant
                # is not clipped off the front of the phrase.
                self._buffer = list(self._preroll)
                self._preroll = []
                self._silence_run = 0
                self._speech_frames = self._speech_run
                self._start_frame = self._frames_seen - len(self._buffer)
            return None

        self._buffer.append(frame)
        if speech:
            self._speech_frames += 1
            self._silence_run = 0
        else:
            self._silence_run += 1

        if self._silence_run >= self.settings.hangover_frames:
            return self._finish("pause")

        if self._seconds(len(self._buffer)) >= self.settings.max_utterance_seconds:
            return self._finish("length")

        return None

    def flush(self) -> Utterance | None:
        """End whatever is in progress. Called when the user stops dictating."""
        if not self._speaking:
            return None
        return self._finish("stopped")

    def _finish(self, reason: str) -> Utterance | None:
        frames = self._buffer
        start_frame = self._start_frame
        speech_frames = self._speech_frames
        trailing = self._silence_run

        self._speaking = False
        self._buffer = []
        self._preroll = []
        self._speech_run = 0
        self._silence_run = 0
        self._speech_frames = 0

        if not frames or speech_frames < self.settings.min_speech_frames:
            return None      # a cough, a door closing, a keyboard

        # Drop most of the trailing pause. Keeping it costs recognition time and
        # gives Whisper silence to hallucinate into.
        excess = max(0, trailing - self.settings.keep_tail_frames)
        if excess:
            frames = frames[:-excess]
        if not frames:
            return None

        audio = np.concatenate(frames)
        return Utterance(
            audio=audio,
            start=self._seconds(start_frame),
            end=self._seconds(start_frame + len(frames)),
            reason=reason,
        )


def frames_of(audio: np.ndarray) -> list[np.ndarray]:
    """Chop a signal into VAD sized frames, dropping the ragged tail."""
    count = len(audio) // FRAME_SAMPLES
    return [audio[i * FRAME_SAMPLES:(i + 1) * FRAME_SAMPLES] for i in range(count)]
