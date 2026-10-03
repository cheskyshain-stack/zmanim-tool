"""SRT and VTT export.

Both formats are the same idea with different punctuation, so they share the
cue building and differ only in how a timestamp is written and what goes at the
top of the file.

Cues follow the engine's own segments rather than being re-cut, because the
segment boundaries are where the model heard a pause, and re-cutting them would
put subtitle breaks in places nobody spoke.
"""

from __future__ import annotations

from pathlib import Path

from ..core.models import CorrectedTranscript, OutputMode
from ..language import render


def _cues(
    corrected: CorrectedTranscript,
    mode: OutputMode,
    policy: render.RenderPolicy | None,
    categories: dict[str, str] | None,
) -> list[tuple[float, float, str]]:
    out = []
    for index, segment in enumerate(corrected.transcript.segments):
        text = render.render_segment(
            segment, corrected.for_segment(index), mode, policy, categories
        ).strip()
        if not text:
            continue
        if segment.speaker and (policy is None or policy.include_speakers):
            text = f"{segment.speaker}: {text}"
        end = max(segment.end, segment.start + 0.5)
        out.append((segment.start, end, text))
    return out


def write_srt(
    corrected: CorrectedTranscript,
    path: Path | str,
    mode: OutputMode,
    policy: render.RenderPolicy | None = None,
    categories: dict[str, str] | None = None,
) -> Path:
    path = Path(path)
    lines = []
    for number, (start, end, text) in enumerate(_cues(corrected, mode, policy, categories), 1):
        lines.append(str(number))
        lines.append(
            f"{render.timestamp(start, True, True)} --> {render.timestamp(end, True, True)}"
        )
        lines.append(text)
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def write_vtt(
    corrected: CorrectedTranscript,
    path: Path | str,
    mode: OutputMode,
    policy: render.RenderPolicy | None = None,
    categories: dict[str, str] | None = None,
) -> Path:
    path = Path(path)
    lines = ["WEBVTT", ""]
    for start, end, text in _cues(corrected, mode, policy, categories):
        lines.append(f"{render.timestamp(start, True)} --> {render.timestamp(end, True)}")
        lines.append(text)
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
    return path
