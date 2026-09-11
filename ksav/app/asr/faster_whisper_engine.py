"""Speech recognition through faster-whisper.

The engine never downloads anything. It is handed a folder by the ModelManager
and refuses to run if that folder is not there, which is what keeps the offline
guarantee true even though the library underneath is perfectly capable of
fetching a model on its own.

Two things here exist specifically for Yeshivish speech:

* ``hotwords`` and ``initial_prompt`` carry dictionary terms into the decoder,
  so recognition is biased toward Torah vocabulary before the model commits to a
  word rather than only being cleaned up afterwards. Whisper's prompt is capped
  at roughly 224 tokens, so the caller sends a ranked selection.
* The language is forced rather than detected by default. Yeshivish carried in
  English is still English as far as the model is concerned, and letting it
  detect per window makes it flip mid sentence on a run of Hebrew terms, which
  is worse than being slightly wrong in one direction.
"""

from __future__ import annotations

import threading
from pathlib import Path

from ..core.logging import get
from ..core.models import Segment, Transcript, Word
from .audio import decode
from .base import (
    AsrEngine,
    CancelFn,
    EngineCapabilities,
    EngineUnavailable,
    ProgressEvent,
    ProgressFn,
    SegmentFn,
    TranscribeOptions,
)

log = get(__name__)

# Beam width by quality setting. Whisper's own default is 5; dropping to 1 is
# roughly twice as fast and noticeably worse on unusual vocabulary, which is
# exactly the vocabulary this application cares about.
BEAM_BY_QUALITY = {"accuracy": 5, "balanced": 5, "speed": 1}
BEST_OF_BY_QUALITY = {"accuracy": 5, "balanced": 2, "speed": 1}


class FasterWhisperEngine(AsrEngine):
    id = "faster_whisper"
    name = "faster-whisper"
    capabilities = EngineCapabilities(
        word_timestamps=True,
        language_detection=True,
        translation=True,
        hotwords=True,
        initial_prompt=True,
        gpu=True,
        streaming=False,
    )

    def __init__(self, model_root: Path | None = None) -> None:
        self._model = None
        self._loaded_key: tuple | None = None
        self._lock = threading.Lock()
        self._model_root = model_root

    # -- availability ----------------------------------------------------

    def is_available(self) -> tuple[bool, str]:
        try:
            import faster_whisper  # noqa: F401
        except ImportError:
            return False, (
                "The faster-whisper package is not installed. Reinstall Ksav, or "
                "install it with pip if you are running from source."
            )
        return True, "Ready. Needs a model from the Model Vault before it can run."

    def model_path(self, model_id: str) -> Path:
        from ..platform.models import BY_ID, ModelManager

        manager = ModelManager(self._model_root) if self._model_root else ModelManager()
        path = manager.path_for(model_id)
        if path is None:
            spec = BY_ID.get(model_id)
            name = spec.name if spec else model_id
            raise EngineUnavailable(
                f"{name} is not installed on this computer. Open the Model Vault to "
                f"install it, either from a USB stick or by downloading it once."
            )
        return path

    # -- device selection ------------------------------------------------

    @staticmethod
    def resolve_device(device: str, compute_type: str) -> tuple[str, str]:
        """Turn 'auto' into something concrete, and pick a matching precision.

        float16 on a processor is slower than int8 and no more accurate, and
        int8 on a modern GPU throws away most of the speed. Getting this pairing
        wrong is the usual reason a local Whisper setup feels sluggish.
        """
        if device == "auto":
            device = "cuda" if _cuda_present() else "cpu"
        if compute_type == "auto":
            compute_type = "float16" if device == "cuda" else "int8"
        return device, compute_type

    def _load(self, options: TranscribeOptions):
        from faster_whisper import WhisperModel

        device, compute_type = self.resolve_device(options.device, options.compute_type)
        path = self.model_path(options.model_id)
        key = (str(path), device, compute_type)

        with self._lock:
            if self._loaded_key == key and self._model is not None:
                return self._model
            if self._model is not None:
                self.unload()

            log.info("loading %s on %s (%s)", options.model_id, device, compute_type)
            try:
                self._model = WhisperModel(
                    str(path),
                    device=device,
                    compute_type=compute_type,
                    local_files_only=True,      # never reach for the network
                )
            except Exception as exc:
                message = str(exc)
                if "cudnn" in message.lower() or "cublas" in message.lower():
                    raise EngineUnavailable(
                        "The graphics card could not be used because a CUDA library is "
                        "missing. Ksav will run on the processor instead: choose "
                        "Processor under Run on in Settings."
                    ) from exc
                raise EngineUnavailable(
                    f"{options.model_id} could not be loaded. {message}"
                ) from exc
            self._loaded_key = key
            return self._model

    def unload(self) -> None:
        self._model = None
        self._loaded_key = None

    # -- transcription ---------------------------------------------------

    def transcribe(
        self,
        audio_path: Path,
        options: TranscribeOptions,
        on_progress: ProgressFn | None = None,
        should_cancel: CancelFn | None = None,
        on_segment: SegmentFn | None = None,
    ) -> Transcript:
        audio_path = Path(audio_path)
        info = decode.probe(audio_path)
        model = self._load(options)

        beam = BEAM_BY_QUALITY.get(options.quality_key(), 5)
        best_of = BEST_OF_BY_QUALITY.get(options.quality_key(), 2)

        kwargs = dict(
            language=options.language,
            beam_size=beam,
            best_of=best_of,
            temperature=options.temperature,
            word_timestamps=options.word_timestamps,
            vad_filter=options.vad_filter,
            condition_on_previous_text=False,   # stops one bad guess cascading
        )
        if options.initial_prompt:
            kwargs["initial_prompt"] = options.initial_prompt
        if options.hotwords:
            kwargs["hotwords"] = " ".join(options.hotwords)
        if options.start_at > 0:
            kwargs["clip_timestamps"] = [options.start_at, info.duration]

        if on_progress:
            on_progress(ProgressEvent(0.0, info.duration, 0, "Loading the recording"))

        try:
            raw_segments, whisper_info = model.transcribe(str(audio_path), **kwargs)
        except Exception as exc:
            raise EngineUnavailable(
                f"{audio_path.name} could not be transcribed: {exc}"
            ) from exc

        segments: list[Segment] = []
        cancelled = False
        previous_end = options.start_at

        # faster-whisper yields lazily, so this loop is where the work happens
        # and where progress and cancellation actually take effect.
        for raw in raw_segments:
            if should_cancel and should_cancel():
                cancelled = True
                break

            text = (raw.text or "").strip()
            if not text:
                continue

            gap = raw.start - previous_end
            segments.append(Segment(
                index=len(segments),
                start=round(raw.start, 3),
                end=round(raw.end, 3),
                text=text,
                words=_words(raw),
                paragraph_break=bool(segments) and gap >= options.paragraph_pause,
                no_speech_prob=getattr(raw, "no_speech_prob", None),
            ))
            previous_end = raw.end
            if on_segment:
                on_segment(segments[-1])

            if on_progress:
                on_progress(ProgressEvent(
                    raw.end, info.duration, len(segments),
                    f"{len(segments)} sections",
                ))

        if on_progress and not cancelled:
            on_progress(ProgressEvent(info.duration, info.duration, len(segments), "Finished"))

        return Transcript(
            source_path=str(audio_path),
            duration=info.duration,
            language=getattr(whisper_info, "language", options.language),
            engine_id=self.id,
            model_id=options.model_id,
            segments=segments,
            complete=not cancelled,
        )


def _words(raw) -> list[Word]:
    out: list[Word] = []
    for word in getattr(raw, "words", None) or ():
        text = (getattr(word, "word", "") or "").strip()
        if not text:
            continue
        out.append(Word(
            text=text,
            start=round(word.start, 3),
            end=round(word.end, 3),
            probability=getattr(word, "probability", None),
        ))
    return out


def _cuda_present() -> bool:
    """Whether CTranslate2 can actually see a usable CUDA device.

    Asking the library rather than looking for a driver, because a machine can
    have an NVIDIA card and still not have a working CUDA runtime, and finding
    that out at load time is worse than finding it out now.
    """
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


def register_into(registry) -> None:
    registry.register(FasterWhisperEngine.id, FasterWhisperEngine)
