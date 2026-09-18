"""Plain text export. Unicode throughout, so Hebrew survives."""

from __future__ import annotations

from pathlib import Path

from ..core.models import CorrectedTranscript, OutputMode
from ..language import render


def write(
    corrected: CorrectedTranscript,
    path: Path | str,
    mode: OutputMode,
    policy: render.RenderPolicy | None = None,
    categories: dict[str, str] | None = None,
) -> Path:
    path = Path(path)
    text = render.render(corrected, mode, policy, categories)
    # UTF-8 with a BOM, because Notepad still guesses the encoding wrongly
    # without one and turns Hebrew into mojibake.
    path.write_text(text, encoding="utf-8-sig")
    return path
