"""The data structures every layer agrees on.

The single most important idea in Ksav lives here: a transcript is stored once,
exactly as the recognition engine produced it, and every Yeshivish correction is
recorded separately as a Correction pointing at a character span. The four output
modes are then four ways of rendering the same pair, not four separate documents.

That is what makes Mode D (raw) genuinely raw, makes switching modes instant and
lossless, and makes it possible to fix a dictionary entry and have old
transcripts come out right afterwards.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id() -> str:
    return uuid.uuid4().hex[:12]


class OutputMode(str, Enum):
    """The four renderings described in the brief."""

    YESHIVISH_ENGLISH = "yeshivish_english"   # Mode A: "The Gemara asks a kashya"
    HEBREW_SCRIPT = "hebrew_script"           # Mode B: "The gemara asks a kashya" in Hebrew letters
    AUTO_MIXED = "auto_mixed"                 # Mode C: decided per term
    RAW = "raw"                               # Mode D: untouched engine output


MODE_LABELS = {
    OutputMode.YESHIVISH_ENGLISH: "Yeshivish English",
    OutputMode.HEBREW_SCRIPT: "Hebrew script",
    OutputMode.AUTO_MIXED: "Automatic mixed",
    OutputMode.RAW: "Original (raw)",
}


@dataclass
class Word:
    """One recognised word with its timing, when the engine provides timings."""

    text: str
    start: float
    end: float
    probability: float | None = None


@dataclass
class Segment:
    """A contiguous run of speech as the engine chose to divide it.

    ``text`` is the engine's own output and is never edited in place. Corrections
    reference ``index`` plus character offsets into this string.
    """

    index: int
    start: float
    end: float
    text: str
    words: list[Word] = field(default_factory=list)
    speaker: str | None = None
    # True when a pause or a speaker change means a paragraph should start here.
    paragraph_break: bool = False
    no_speech_prob: float | None = None


@dataclass
class Transcript:
    """The complete result of transcribing one recording."""

    id: str = field(default_factory=new_id)
    source_path: str = ""
    duration: float = 0.0
    language: str | None = None
    engine_id: str = ""
    model_id: str = ""
    segments: list[Segment] = field(default_factory=list)
    created_at: str = field(default_factory=_now)
    # Set when the job did not finish, so the queue knows where to pick up.
    complete: bool = True

    def text(self) -> str:
        return "".join(
            ("\n\n" if seg.paragraph_break and i else (" " if i else "")) + seg.text.strip()
            for i, seg in enumerate(self.segments)
        )

    def segment_at(self, seconds: float) -> Segment | None:
        for seg in self.segments:
            if seg.start <= seconds <= seg.end:
                return seg
        return None


class CorrectionKind(str, Enum):
    EXACT = "exact"           # the variant matched literally
    PHONETIC = "phonetic"     # matched through the phonetic key, always a suggestion
    SPELLING = "spelling"     # canonical spelling preference, low risk


@dataclass
class Correction:
    """One proposed or applied change, with enough provenance to undo and explain it.

    ``applied`` False means the correction engine found it but the gating rules
    (risk tier, missing context, confidence below threshold) held it back. It is
    shown to the user as a suggestion instead of being written into their text.
    """

    segment_index: int
    start: int              # character offset into Segment.text
    end: int
    raw: str                # exactly what the engine wrote
    entry_id: str
    canonical: str          # Mode A form, for example "Gemara"
    hebrew: str | None      # Mode B form, for example "גמרא"
    kind: CorrectionKind = CorrectionKind.EXACT
    confidence: float = 1.0
    reason: str = ""        # human readable, shown in the corrections panel
    applied: bool = True
    prefer_hebrew: bool = False   # drives Mode C for this term

    @property
    def span(self) -> tuple[int, int]:
        return (self.start, self.end)


@dataclass
class CorrectedTranscript:
    """A transcript plus the corrections found against it. Renderable in any mode."""

    transcript: Transcript
    corrections: list[Correction] = field(default_factory=list)

    def for_segment(self, index: int) -> list[Correction]:
        return sorted(
            (c for c in self.corrections if c.segment_index == index),
            key=lambda c: c.start,
        )

    @property
    def applied_count(self) -> int:
        return sum(1 for c in self.corrections if c.applied)

    @property
    def suggested_count(self) -> int:
        return sum(1 for c in self.corrections if not c.applied)


# ---------------------------------------------------------------------------
# OCR side
# ---------------------------------------------------------------------------


class BlockKind(str, Enum):
    PARAGRAPH = "paragraph"
    HEADING = "heading"
    COLUMN = "column"
    CAPTION = "caption"
    UNKNOWN = "unknown"


@dataclass
class TextBlock:
    """One recognised region on a page.

    ``bbox`` is (x, y, width, height) in pixels on the page image, which is what
    lets the review screen highlight the picture when the cursor is in the text.
    ``direction`` is per block, not per page, because a sefer page can carry a
    Hebrew body and an English footnote.
    """

    text: str
    bbox: tuple[int, int, int, int]
    kind: BlockKind = BlockKind.PARAGRAPH
    direction: str = "rtl"          # "rtl" or "ltr"
    confidence: float = 0.0
    reading_order: int = 0
    language: str | None = None


@dataclass
class PageText:
    """The OCR result for a single page or image."""

    page_number: int = 1
    blocks: list[TextBlock] = field(default_factory=list)
    image_path: str = ""            # the rendered or original page image
    source_path: str = ""           # the PDF or image the page came from
    width: int = 0
    height: int = 0
    engine_id: str = ""
    rotation: float = 0.0           # degrees the preprocessor corrected by
    from_text_layer: bool = False   # True when the PDF already had real text
    columns: int = 1
    preprocessing: str = ""         # what the cleanup steps actually did
    # Honest warnings for this page: missing language data, a script the engine
    # is known to be poor at, a tilt it declined to correct.
    notes: list[str] = field(default_factory=list)

    @property
    def confidence(self) -> float:
        """Mean confidence across the page, 0 to 1. Zero when nothing was read."""
        scored = [b.confidence for b in self.blocks if b.text.strip()]
        return round(sum(scored) / len(scored), 3) if scored else 0.0

    def text(self) -> str:
        ordered = sorted(self.blocks, key=lambda b: b.reading_order)
        return "\n\n".join(b.text.strip() for b in ordered if b.text.strip())


@dataclass
class Document:
    """A multi page OCR result: a PDF, or a batch of images treated as one."""

    id: str = field(default_factory=new_id)
    source_path: str = ""
    pages: list[PageText] = field(default_factory=list)
    created_at: str = field(default_factory=_now)

    def text(self) -> str:
        return "\n\n".join(p.text() for p in self.pages)


def to_dict(obj: Any) -> dict:
    """Serialise any dataclass here, with Enums flattened to their values."""

    def convert(value: Any) -> Any:
        if isinstance(value, Enum):
            return value.value
        if isinstance(value, dict):
            return {k: convert(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [convert(v) for v in value]
        return value

    return convert(asdict(obj))
