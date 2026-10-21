"""The four output modes.

All four are renderings of one stored pair: the engine's own transcript, and the
corrections annotated against it. Nothing here modifies the transcript, which is
why Mode D is genuinely the raw output rather than an attempt to undo changes,
and why switching modes costs nothing.

    Mode A  Yeshivish English   The Gemara asks a kashya on Rav Huna.
    Mode B  Hebrew script       The גמרא asks a קשיא on רב הונא.
    Mode C  Automatic mixed     decided per term
    Mode D  Original            exactly what the engine wrote
"""

from __future__ import annotations

from dataclasses import dataclass

from ..core.models import (
    Correction,
    CorrectedTranscript,
    OutputMode,
    Segment,
    Transcript,
)
from .normalize import title_case_like


@dataclass
class RenderPolicy:
    """How Mode C decides, and what a rendered transcript carries."""

    hebrew_for_masechtos: bool = True
    hebrew_for_seforim: bool = False
    include_timestamps: bool = False
    include_speakers: bool = True

    @classmethod
    def from_settings(cls, settings) -> "RenderPolicy":
        return cls(
            hebrew_for_masechtos=settings.language.hebrew_for_masechtos,
            hebrew_for_seforim=settings.language.hebrew_for_seforim,
            include_timestamps=settings.export.include_timestamps,
            include_speakers=settings.export.include_speakers,
        )


def replacement_for(
    correction: Correction,
    mode: OutputMode,
    policy: RenderPolicy,
    categories: dict[str, str] | None = None,
) -> str:
    """What this term should read as in this mode."""
    if mode is OutputMode.RAW:
        return correction.raw

    if mode is OutputMode.HEBREW_SCRIPT and correction.hebrew:
        return correction.hebrew

    if mode is OutputMode.AUTO_MIXED and correction.hebrew:
        # Per term preference wins. Otherwise the category decides, which is how
        # a user says "masechtos in Hebrew, everything else in English" once
        # rather than term by term.
        if correction.prefer_hebrew:
            return correction.hebrew
        category = (categories or {}).get(correction.entry_id, "")
        if category == "masechta" and policy.hebrew_for_masechtos:
            return correction.hebrew
        if category == "sefer" and policy.hebrew_for_seforim:
            return correction.hebrew

    return title_case_like(correction.canonical, correction.raw)


def render_segment(
    segment: Segment,
    corrections: list[Correction],
    mode: OutputMode,
    policy: RenderPolicy | None = None,
    categories: dict[str, str] | None = None,
) -> str:
    """One segment, with every applied correction written in."""
    if mode is OutputMode.RAW or not corrections:
        return segment.text

    policy = policy or RenderPolicy()
    pieces: list[str] = []
    cursor = 0
    for correction in sorted(corrections, key=lambda c: c.start):
        if not correction.applied or correction.start < cursor:
            continue
        replacement = replacement_for(correction, mode, policy, categories)
        if replacement == correction.raw:
            continue
        pieces.append(segment.text[cursor:correction.start])
        pieces.append(replacement)
        cursor = correction.end
    pieces.append(segment.text[cursor:])
    return "".join(pieces)


def render(
    corrected: CorrectedTranscript,
    mode: OutputMode,
    policy: RenderPolicy | None = None,
    categories: dict[str, str] | None = None,
) -> str:
    """The whole transcript as text, with paragraphs where the pauses were."""
    policy = policy or RenderPolicy()
    transcript = corrected.transcript
    out: list[str] = []

    for index, segment in enumerate(transcript.segments):
        text = render_segment(
            segment, corrected.for_segment(index), mode, policy, categories
        ).strip()
        if not text:
            continue

        prefix = ""
        if policy.include_timestamps:
            prefix += f"[{timestamp(segment.start)}] "
        if policy.include_speakers and segment.speaker:
            prefix += f"{segment.speaker}: "

        if index and segment.paragraph_break:
            out.append("\n\n")
        elif out:
            out.append(" " if not prefix else "\n")
        out.append(prefix + text)

    return "".join(out).strip()


def render_paragraphs(
    corrected: CorrectedTranscript,
    mode: OutputMode,
    policy: RenderPolicy | None = None,
    categories: dict[str, str] | None = None,
) -> list[tuple[float, str]]:
    """Paragraphs with the time each one starts, for the editor and for DOCX."""
    policy = policy or RenderPolicy()
    transcript = corrected.transcript
    paragraphs: list[tuple[float, str]] = []
    current: list[str] = []
    start = 0.0

    for index, segment in enumerate(transcript.segments):
        text = render_segment(
            segment, corrected.for_segment(index), mode, policy, categories
        ).strip()
        if not text:
            continue
        if not current:
            start = segment.start
        elif segment.paragraph_break:
            paragraphs.append((start, " ".join(current)))
            current, start = [], segment.start
        current.append(text)

    if current:
        paragraphs.append((start, " ".join(current)))
    return paragraphs


def timestamp(seconds: float, millis: bool = False, comma: bool = False) -> str:
    """hh:mm:ss, with the subtitle variants that SRT and VTT each insist on."""
    seconds = max(0.0, seconds)
    hours, rest = divmod(int(seconds), 3600)
    minutes, secs = divmod(rest, 60)
    if not millis:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    fraction = int(round((seconds - int(seconds)) * 1000))
    if fraction == 1000:
        fraction = 999
    separator = "," if comma else "."
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{fraction:03d}"
