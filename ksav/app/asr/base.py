"""The speech recognition interface.

Everything above this line in the stack talks to ``AsrEngine`` and never to
faster-whisper, whisper.cpp, or whatever replaces them. Adding an engine is a
new file plus one registry line.

Two parts of this interface exist specifically for Yeshivish speech:

* ``TranscribeOptions.hotwords`` and ``initial_prompt`` carry terms from the
  dictionary into the decoder, so recognition is biased toward Torah vocabulary
  before the model commits to a word, rather than only being cleaned up after.
* ``EngineCapabilities`` is honest about what an engine cannot do, so the UI can
  hide a control instead of offering something that will not work.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from ..core.models import Transcript


@dataclass
class EngineCapabilities:
    word_timestamps: bool = False
    language_detection: bool = False
    translation: bool = False
    hotwords: bool = False
    initial_prompt: bool = False
    gpu: bool = False
    streaming: bool = False


@dataclass
class TranscribeOptions:
    model_id: str = "whisper-medium"
    language: str | None = "en"
    device: str = "auto"
    compute_type: str = "auto"
    beam_size: int = 5
    vad_filter: bool = True
    word_timestamps: bool = True
    # Terms lifted from the dictionary to bias the decoder. Whisper's prompt is
    # capped at roughly 224 tokens, so this is a ranked selection, never the
    # whole vocabulary. The caller does the ranking.
    hotwords: list[str] = field(default_factory=list)
    initial_prompt: str | None = None
    # Start offset in seconds, used when resuming an interrupted job.
    start_at: float = 0.0
    temperature: float = 0.0


@dataclass
class ProgressEvent:
    """Emitted as work completes so the UI can show real progress, not a spinner."""

    seconds_done: float
    seconds_total: float
    segments_done: int
    message: str = ""

    @property
    def fraction(self) -> float:
        if self.seconds_total <= 0:
            return 0.0
        return min(1.0, self.seconds_done / self.seconds_total)


ProgressFn = Callable[[ProgressEvent], None]
CancelFn = Callable[[], bool]


class EngineUnavailable(RuntimeError):
    """The engine cannot run: a library is missing, or the model is not installed.

    The message is written for the user, not the developer, because it is shown
    in the interface verbatim.
    """


class AsrEngine(abc.ABC):
    """One speech recognition backend."""

    id: str = ""
    name: str = ""
    capabilities = EngineCapabilities()

    @abc.abstractmethod
    def is_available(self) -> tuple[bool, str]:
        """Return (usable, reason). ``reason`` is shown to the user when not usable."""

    @abc.abstractmethod
    def transcribe(
        self,
        audio_path: Path,
        options: TranscribeOptions,
        on_progress: ProgressFn | None = None,
        should_cancel: CancelFn | None = None,
    ) -> Transcript:
        """Transcribe a whole file.

        Implementations must honour ``should_cancel`` promptly and must raise
        :class:`EngineUnavailable` rather than a library specific exception when
        the problem is a missing model or dependency.
        """

    def unload(self) -> None:
        """Release the model from memory. Optional."""
