"""Live dictation: speak, and the text appears.

The honest shape of this, stated in the plan and unchanged by building it: text
appears when you pause, not word by word. Whisper is not a streaming model. It
sees a phrase, thinks, and answers, so the delay is roughly the hangover pause
plus however long recognition takes. On a GPU with the small model that is well
under a second after you stop talking. On a slow processor it is longer, and the
interface says which model is being used for exactly that reason.

Recognising truly word by word would need a streaming model, and none of the
ones that exist know Hebrew. That is a real limit rather than a shortcut.

Everything runs on this computer. The microphone stream never leaves it.
"""

from __future__ import annotations

import queue
import tempfile
import threading
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np

from ..asr import registry as asr_registry
from ..asr.audio import capture, vad as vad_module
from ..asr.base import TranscribeOptions
from ..core.logging import get
from ..core.models import CorrectedTranscript, Segment, Transcript
from ..language import corrector, render
from ..core.models import OutputMode

log = get(__name__)


class State:
    IDLE = "idle"
    LISTENING = "listening"
    THINKING = "thinking"
    STOPPING = "stopping"


@dataclass
class Phrase:
    """One recognised phrase, raw and corrected."""

    raw: str
    text: str
    start: float
    end: float
    corrections: int = 0

    @property
    def changed(self) -> bool:
        return self.raw != self.text


class DictationService:
    """Microphone in, corrected text out, a phrase at a time."""

    def __init__(
        self,
        settings,
        transcription_service,
        source: capture.AudioSource | None = None,
        vad: vad_module.Vad | None = None,
    ) -> None:
        self.settings = settings
        self._transcription = transcription_service
        self._source = source
        self._vad = vad
        self._segmenter: vad_module.Segmenter | None = None

        self._queue: "queue.Queue[vad_module.Utterance | None]" = queue.Queue()
        self._worker: threading.Thread | None = None
        self._state = State.IDLE
        self._lock = threading.Lock()

        self.on_phrase: Callable[[Phrase], None] | None = None
        self.on_state: Callable[[str], None] | None = None
        self.on_error: Callable[[str], None] | None = None

    # -- availability ----------------------------------------------------

    def available(self) -> tuple[bool, str]:
        """Whether dictation can run, and what is missing when it cannot."""
        if self._source is None:
            usable, reason = capture.available()
            if not usable:
                return False, reason

        model_id = self.settings.dictation.model_id
        engine_id = self.settings.transcription.engine_id
        try:
            engine = asr_registry.get(engine_id)
        except KeyError as exc:
            return False, str(exc)

        usable, reason = engine.is_available()
        if not usable:
            return False, reason

        from ..platform.models import BY_ID, ModelManager

        if BY_ID.get(model_id) and not ModelManager().is_installed(model_id):
            spec = BY_ID[model_id]
            return False, (
                f"Dictation needs {spec.name}, which is not installed. Open the "
                f"Model Vault to install it, from a USB stick or by downloading it."
            )
        return True, "Ready."

    @property
    def state(self) -> str:
        return self._state

    @property
    def level(self) -> float:
        return self._source.level if self._source else 0.0

    @property
    def listening(self) -> bool:
        return self._state in (State.LISTENING, State.THINKING)

    # -- lifecycle -------------------------------------------------------

    def start(self) -> tuple[bool, str]:
        with self._lock:
            if self.listening:
                return True, "Already listening."

            usable, reason = self.available()
            if not usable:
                return False, reason

            if self._source is None:
                self._source = capture.MicrophoneSource(
                    self.settings.dictation.input_device or None
                )
            if self._vad is None:
                self._vad = vad_module.build(self._silero_path())

            self._segmenter = vad_module.Segmenter(self._vad, self._vad_settings())
            self._queue = queue.Queue()

            self._worker = threading.Thread(
                target=self._transcribe_loop, name="ksav-dictation", daemon=True
            )
            self._worker.start()

            # The state has to be LISTENING before the first frame arrives, or
            # _on_frame drops it. A real microphone takes a few milliseconds to
            # deliver anything so this looked fine, but the race is real and a
            # buffered source loses every frame to it.
            self._set_state(State.LISTENING)
            try:
                self._source.start(self._on_frame)
            except Exception as exc:
                self._set_state(State.IDLE)
                self._queue.put(None)
                return False, f"The microphone could not be opened: {exc}"

            return True, "Listening."

    def stop(self, wait: float = 12.0) -> None:
        """Stop listening, but finish the phrase already in progress."""
        with self._lock:
            if self._state == State.IDLE:
                return
            self._set_state(State.STOPPING)

        if self._source:
            self._source.stop()
        if self._segmenter:
            tail = self._segmenter.flush()
            if tail:
                self._queue.put(tail)

        self._queue.put(None)
        if self._worker:
            self._worker.join(timeout=wait)
        self._worker = None
        self._set_state(State.IDLE)

    def toggle(self) -> tuple[bool, str]:
        if self.listening:
            self.stop()
            return True, "Stopped."
        return self.start()

    # -- the audio side --------------------------------------------------

    def _on_frame(self, frame: np.ndarray) -> None:
        segmenter = self._segmenter
        if segmenter is None or self._state == State.IDLE:
            return
        try:
            utterance = segmenter.push(frame)
        except Exception as exc:
            log.warning("speech detection failed on a frame: %s", exc)
            return
        if utterance is not None:
            self._queue.put(utterance)

    def _vad_settings(self) -> vad_module.VadSettings:
        return vad_module.VadSettings()

    def _silero_path(self) -> Path | None:
        from ..platform.models import BY_ID, ModelManager

        spec = BY_ID.get("vad-silero")
        if spec is None:
            return None
        directory = ModelManager().path_for("vad-silero")
        if directory is None:
            return None
        return directory / spec.files[0].name

    # -- the recognition side --------------------------------------------

    def _transcribe_loop(self) -> None:
        while True:
            utterance = self._queue.get()
            if utterance is None:
                break
            if self._state == State.IDLE:
                continue
            try:
                self._set_state(State.THINKING)
                phrase = self._recognise(utterance)
                if phrase and phrase.text.strip() and self.on_phrase:
                    self.on_phrase(phrase)
            except Exception as exc:
                log.exception("dictation failed on a phrase")
                if self.on_error:
                    self.on_error(str(exc))
            finally:
                if self._state != State.IDLE:
                    self._set_state(
                        State.LISTENING if self._state != State.STOPPING else State.STOPPING
                    )

    def _recognise(self, utterance: vad_module.Utterance) -> Phrase | None:
        engine = asr_registry.get(self.settings.transcription.engine_id)
        options = self._options()

        with tempfile.TemporaryDirectory(prefix="ksav-dictation-") as folder:
            path = Path(folder) / "phrase.wav"
            write_wav(path, utterance.audio)
            transcript = engine.transcribe(path, options)

        raw = transcript.text().strip()
        if not raw:
            return None

        if not self.settings.dictation.apply_corrections:
            return Phrase(raw=raw, text=raw, start=utterance.start, end=utterance.end)

        # Correct the phrase the same way a whole transcript is corrected, so
        # dictated text and transcribed text come out spelled identically.
        segment = Segment(0, utterance.start, utterance.end, raw)
        stub = Transcript(segments=[segment])
        corrections = corrector.correct(
            stub, self._transcription.index,
            corrector.Policy.from_settings(self.settings),
        )
        corrected = CorrectedTranscript(stub, corrections)
        mode = OutputMode(self.settings.language.output_mode)
        text = render.render(
            corrected, mode, render.RenderPolicy.from_settings(self.settings),
            self._categories(),
        ).strip()

        applied = sum(
            1 for c in corrections
            if c.applied and c.raw.casefold() != c.canonical.casefold()
        )
        return Phrase(raw=raw, text=text or raw, start=utterance.start,
                      end=utterance.end, corrections=applied)

    def _categories(self) -> dict[str, str]:
        try:
            return {e.id: e.category for e in self._transcription.lexicon.all()}
        except Exception:
            return {}

    def _options(self) -> TranscribeOptions:
        d = self.settings.dictation
        t = self.settings.transcription
        hotwords, prompt = self._transcription.priming()
        return TranscribeOptions(
            model_id=d.model_id,
            language=t.language,
            device=t.device,
            compute_type=t.compute_type,
            # A phrase is already trimmed to speech, so a second silence filter
            # only risks removing the start of a quiet word.
            vad_filter=False,
            word_timestamps=False,
            hotwords=hotwords,
            initial_prompt=prompt,
            quality="speed",       # latency matters more than the last percent
        )

    def _set_state(self, state: str) -> None:
        if state == self._state:
            return
        self._state = state
        if self.on_state:
            try:
                self.on_state(state)
            except Exception:
                log.exception("dictation state listener raised")


def write_wav(path: Path, audio: np.ndarray, sample_rate: int = vad_module.SAMPLE_RATE) -> Path:
    """16 bit mono PCM, which every recognition engine reads."""
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(pcm.tobytes())
    return path
