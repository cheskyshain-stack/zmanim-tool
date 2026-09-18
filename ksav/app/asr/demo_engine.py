"""A recognition engine that needs no model, for building and testing the UI.

This exists so that the interface, the job queue, the corrections panel and the
exporters can all be exercised end to end before a three gigabyte download, and
so tests run in a second rather than a minute. It produces a fixed Yeshivish
passage with plausible timings, including the misrecognitions the correction
engine is meant to catch.

It is registered under the id ``demo`` and is never a default.
"""

from __future__ import annotations

import time
from pathlib import Path

from ..core.models import Segment, Transcript, Word
from .base import (
    AsrEngine,
    CancelFn,
    EngineCapabilities,
    ProgressEvent,
    ProgressFn,
    SegmentFn,
    TranscribeOptions,
)

# Deliberately written the way an engine that has never heard Yeshivish would
# write it: "camera" for Gemara, "kasha" for kashya, "Tosfos" unpunctuated,
# "shver" spelled by ear.
_PASSAGE = [
    "The camera asks a kasha on Rav Huna,",
    "and Tosfos says that according to this svara it's not shver.",
    "The Rambam in hilchos shabbos holds differently,",
    "and the shulchan aruch brings both opinions.",
    "That's really the whole machlokes in this sugya.",
]


class DemoAsrEngine(AsrEngine):
    id = "demo"
    name = "Demo (no model needed)"
    capabilities = EngineCapabilities(
        word_timestamps=True,
        language_detection=False,
        hotwords=False,
        initial_prompt=False,
        gpu=False,
    )

    def is_available(self) -> tuple[bool, str]:
        return True, "Built in. Produces a fixed sample transcript for testing."

    def transcribe(
        self,
        audio_path: Path,
        options: TranscribeOptions,
        on_progress: ProgressFn | None = None,
        should_cancel: CancelFn | None = None,
        on_segment: SegmentFn | None = None,
    ) -> Transcript:
        segments: list[Segment] = []
        clock = 0.0
        total = float(len(_PASSAGE)) * 3.0

        for index, line in enumerate(_PASSAGE):
            if should_cancel and should_cancel():
                break
            duration = 2.4 + 0.12 * len(line.split())
            words = self._words(line, clock, duration)
            segments.append(
                Segment(
                    index=index,
                    start=round(clock, 2),
                    end=round(clock + duration, 2),
                    text=line,
                    words=words,
                    paragraph_break=index == 2,
                )
            )
            if on_segment:
                on_segment(segments[-1])
            clock += duration + 0.35
            if on_progress:
                on_progress(ProgressEvent(clock, total, index + 1, f"segment {index + 1}"))
            time.sleep(0.01)

        return Transcript(
            source_path=str(audio_path),
            duration=round(clock, 2),
            language=options.language or "en",
            engine_id=self.id,
            model_id="demo",
            segments=segments,
            complete=not (should_cancel and should_cancel()),
        )

    @staticmethod
    def _words(line: str, start: float, duration: float) -> list[Word]:
        tokens = line.split()
        if not tokens:
            return []
        step = duration / len(tokens)
        return [
            Word(token, round(start + i * step, 2), round(start + (i + 1) * step, 2), 0.9)
            for i, token in enumerate(tokens)
        ]


def register_into(registry) -> None:
    registry.register(DemoAsrEngine.id, DemoAsrEngine)
