"""Turning a recording into a corrected transcript.

This is where the engine, the dictionary and the correction rules meet. It is
also where two things happen that make a long recording bearable:

* **Priming.** Before the model decides on a word, a ranked selection of Torah
  terms goes into its hotwords and prompt. Whisper's prompt is capped at roughly
  224 tokens, so this is a selection, not the whole vocabulary.
* **Partial saves.** Segments are written to disk as they arrive, so a job that
  is interrupted at two hours resumes from two hours rather than from nothing.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from ..asr import registry as asr_registry
from ..asr.audio import decode
from ..asr.base import TranscribeOptions
from ..core import paths
from ..core.logging import get
from ..core.models import (
    Correction,
    CorrectedTranscript,
    CorrectionKind,
    Segment,
    Transcript,
    Word,
)
from ..language import corrector, matcher
from ..language.lexicon import Lexicon

log = get(__name__)

# Save a partial transcript at least this often, measured in segments. Frequent
# enough that a crash costs little, rare enough not to hammer the disk.
PARTIAL_EVERY = 20

# The sentence that frames the prompt. Whisper takes the prompt as if it were
# the transcript of what came just before, so it has to read like real speech
# rather than a list of instructions.
PROMPT_FRAME = (
    "A shiur in Yeshivish English with Hebrew and Aramaic terms: {terms}."
)


class TranscriptStore:
    """Transcripts on disk, one JSON file each."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root) if root else paths.data_root() / "transcripts"
        self.root.mkdir(parents=True, exist_ok=True)

    def path_for(self, transcript_id: str) -> Path:
        return self.root / f"{transcript_id}.json"

    def save(self, corrected: CorrectedTranscript, partial: bool = False) -> Path:
        transcript = corrected.transcript
        payload = {
            "transcript": _transcript_to_dict(transcript),
            "corrections": [_correction_to_dict(c) for c in corrected.corrections],
            "partial": partial,
        }
        path = self.path_for(transcript.id)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
        return path

    def load(self, path: Path | str) -> CorrectedTranscript:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return CorrectedTranscript(
            transcript=_transcript_from_dict(data["transcript"]),
            corrections=[Correction(**_correction_from_dict(c))
                         for c in data.get("corrections", [])],
        )

    def list(self) -> list[Path]:
        return sorted(self.root.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)


class TranscriptionService:
    """One call from the job queue to a finished, corrected transcript."""

    def __init__(self, settings, lexicon: Lexicon, store: TranscriptStore | None = None) -> None:
        self.settings = settings
        self.lexicon = lexicon
        self.store = store or TranscriptStore()
        self._index: matcher.Index | None = None

    # -- the dictionary index -------------------------------------------

    @property
    def index(self) -> matcher.Index:
        if self._index is None:
            self._index = matcher.build(self.lexicon)
        return self._index

    def invalidate_index(self) -> None:
        """Called after a dictionary edit. Rebuilding is cheap."""
        self._index = None

    # -- priming ---------------------------------------------------------

    def priming(self) -> tuple[list[str], str | None]:
        """Hotwords and prompt for the decoder, or nothing if priming is off."""
        if not self.settings.transcription.prime_with_dictionary:
            return [], None
        terms = self.lexicon.priming_terms(limit=40)
        if not terms:
            return [], None
        return terms, PROMPT_FRAME.format(terms=", ".join(terms[:30]))

    # -- options ---------------------------------------------------------

    def options_for(self, resume_from: float = 0.0) -> TranscribeOptions:
        t = self.settings.transcription
        hotwords, prompt = self.priming()
        return TranscribeOptions(
            model_id=t.model_id,
            language=t.language,
            device=t.device,
            compute_type=t.compute_type,
            vad_filter=t.vad_filter,
            word_timestamps=t.word_timestamps,
            hotwords=hotwords,
            initial_prompt=prompt,
            start_at=resume_from,
            paragraph_pause=t.paragraph_pause,
            quality=t.quality,
        )

    # -- the work --------------------------------------------------------

    def transcribe(
        self,
        audio_path: Path | str,
        *,
        on_progress=None,
        should_cancel=None,
        resume_from: float = 0.0,
        earlier_segments: list[Segment] | None = None,
    ) -> CorrectedTranscript:
        audio_path = Path(audio_path)
        engine = asr_registry.get(self.settings.transcription.engine_id)
        options = self.options_for(resume_from)

        carried = list(earlier_segments or [])
        collected: list[Segment] = []
        holder: dict[str, CorrectedTranscript] = {}

        def remember(segment: Segment) -> None:
            collected.append(segment)
            if len(collected) % PARTIAL_EVERY == 0:
                partial = Transcript(
                    source_path=str(audio_path),
                    duration=segment.end,
                    engine_id=engine.id,
                    model_id=options.model_id,
                    segments=_renumber(carried + collected),
                    complete=False,
                )
                if "id" in holder:
                    partial.id = holder["id"]          # keep one file per job
                else:
                    holder["id"] = partial.id
                self.store.save(CorrectedTranscript(partial), partial=True)

        transcript = engine.transcribe(
            audio_path,
            options,
            on_progress=on_progress,
            should_cancel=should_cancel,
            on_segment=remember,
        )

        if carried:
            transcript.segments = _renumber(carried + transcript.segments)
        if "id" in holder:
            transcript.id = holder["id"]

        corrections = corrector.correct(
            transcript, self.index, corrector.Policy.from_settings(self.settings)
        )
        corrected = CorrectedTranscript(transcript, corrections)
        self.store.save(corrected, partial=not transcript.complete)
        return corrected

    # -- the job queue runner --------------------------------------------

    def make_runner(self):
        """The callable the JobQueue drives. Returns the saved transcript path."""

        def run(job, progress, cancelled) -> str:
            resume_from = 0.0
            earlier: list[Segment] = []

            if job.status == "interrupted" and job.result_path:
                previous = Path(job.result_path)
                if previous.is_file():
                    try:
                        saved = self.store.load(previous)
                        earlier = saved.transcript.segments
                        resume_from = earlier[-1].end if earlier else 0.0
                        log.info("resuming %s from %.1fs", job.name, resume_from)
                    except (OSError, ValueError, KeyError) as exc:
                        log.warning("could not resume %s: %s", job.name, exc)

            info = decode.probe(job.source_path)
            job.duration = info.duration

            corrected = self.transcribe(
                job.source_path,
                on_progress=lambda e: progress(e.seconds_done, e.seconds_total, e.message),
                should_cancel=cancelled,
                resume_from=resume_from,
                earlier_segments=earlier,
            )
            return str(self.store.path_for(corrected.transcript.id))

        return run


def _renumber(segments: list[Segment]) -> list[Segment]:
    for index, segment in enumerate(segments):
        segment.index = index
    return segments


def _transcript_to_dict(transcript: Transcript) -> dict:
    data = asdict(transcript)
    return data


def _transcript_from_dict(data: dict) -> Transcript:
    segments = [
        Segment(
            index=s["index"], start=s["start"], end=s["end"], text=s["text"],
            words=[Word(**w) for w in s.get("words", [])],
            speaker=s.get("speaker"),
            paragraph_break=s.get("paragraph_break", False),
            no_speech_prob=s.get("no_speech_prob"),
        )
        for s in data.get("segments", [])
    ]
    return Transcript(
        id=data.get("id", ""), source_path=data.get("source_path", ""),
        duration=data.get("duration", 0.0), language=data.get("language"),
        engine_id=data.get("engine_id", ""), model_id=data.get("model_id", ""),
        segments=segments, created_at=data.get("created_at", ""),
        complete=data.get("complete", True),
    )


def _correction_to_dict(correction: Correction) -> dict:
    data = asdict(correction)
    data["kind"] = correction.kind.value
    return data


def _correction_from_dict(data: dict) -> dict:
    data = dict(data)
    data["kind"] = CorrectionKind(data.get("kind", "exact"))
    return data
