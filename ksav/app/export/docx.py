"""Word export.

Two things matter here and neither is obvious.

Hebrew inside an otherwise English paragraph needs its runs marked as complex
script, or Word applies the Latin font to Hebrew characters and the result is
either the wrong typeface or a row of boxes. python-docx has no API for that, so
the run property is written directly into the XML.

A paragraph that is entirely Hebrew is also set right to left, while a mixed
paragraph is left to right with the Hebrew runs marked. That is the correct
behaviour for a Yeshivish transcript, where the sentence structure is English.
"""

from __future__ import annotations

from pathlib import Path

from ..core.models import CorrectedTranscript, OutputMode
from ..language import render
from ..language.normalize import is_hebrew


class DocxUnavailable(RuntimeError):
    """python-docx is not installed. The message is shown to the user."""


def _segments_by_script(text: str) -> list[tuple[str, bool]]:
    """Split a string into runs, each entirely Hebrew or entirely not."""
    if not text:
        return []
    runs: list[tuple[str, bool]] = []
    current: list[str] = []
    current_hebrew = is_hebrew(text[0])
    for char in text:
        # Spaces and punctuation join whichever run they follow, so a Hebrew
        # word does not get its trailing space marked as Latin and vice versa.
        char_hebrew = is_hebrew(char) if char.strip() else current_hebrew
        if char_hebrew != current_hebrew:
            runs.append(("".join(current), current_hebrew))
            current, current_hebrew = [], char_hebrew
        current.append(char)
    runs.append(("".join(current), current_hebrew))
    return [(t, h) for t, h in runs if t]


def write(
    corrected: CorrectedTranscript,
    path: Path | str,
    mode: OutputMode,
    policy: render.RenderPolicy | None = None,
    categories: dict[str, str] | None = None,
    title: str = "",
) -> Path:
    try:
        from docx import Document
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        from docx.oxml.ns import qn
        from docx.shared import Pt
    except ImportError as exc:
        raise DocxUnavailable(
            "Word export needs the python-docx package, which is not installed. "
            "Export to TXT instead, or install it and try again."
        ) from exc

    policy = policy or render.RenderPolicy()
    path = Path(path)
    document = Document()

    style = document.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(11)
    # Tell Word which font to use for Hebrew specifically.
    style.element.rPr.rFonts.set(qn("w:cs"), "David")

    if title:
        document.add_heading(title, level=1)

    for start, text in render.render_paragraphs(corrected, mode, policy, categories):
        paragraph = document.add_paragraph()
        if policy.include_timestamps:
            stamp = paragraph.add_run(f"[{render.timestamp(start)}]  ")
            stamp.bold = True

        runs = _segments_by_script(text)
        for content, hebrew in runs:
            run = paragraph.add_run(content)
            if hebrew:
                # Without this Word renders Hebrew in the Latin font.
                rtl = run._element.get_or_add_rPr()
                for tag in ("w:cs", "w:rtl"):
                    element = rtl.makeelement(qn(tag), {})
                    rtl.append(element)

        if runs and all(hebrew for _, hebrew in runs):
            paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT

    document.save(str(path))
    return path
