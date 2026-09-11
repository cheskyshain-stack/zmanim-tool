"""PDF export, with Hebrew that comes out the right way round.

Two things are needed that a plain PDF writer does not do.

**A font with Hebrew letters in it.** The PDF standard fonts have none, so
Frank Ruhl Libre is embedded. It ships under the Open Font Licence, and the
licence text sits beside it in ``app/export/fonts``.

That font is Hebrew only: it maps every Latin letter to an empty box. So each
line is drawn a run at a time, Hebrew runs in the embedded font and Latin runs
in Helvetica, which every PDF reader already has and which costs nothing to
ship. Drawing a mixed line in one font produced a row of boxes where the English
should have been, and it was only visible by rendering the result and looking at
it.

**Bidirectional reordering.** A PDF places glyphs at coordinates; there is no
layout engine to work out that a Hebrew run inside an English sentence should be
drawn right to left. python-bidi applies the Unicode bidi algorithm to each line
before it is drawn. Without it "The גמרא asks" comes out with the Hebrew word
reversed, which looks like a font problem and is not.

Hebrew needs no glyph shaping, unlike Arabic, so reordering is the whole job.
"""

from __future__ import annotations

from pathlib import Path

from ..core.models import CorrectedTranscript, Document, OutputMode
from ..language import render
from ..language.normalize import is_hebrew, split_by_script

FONT_NAME = "FrankRuhlLibre"
FONT_FILE = Path(__file__).parent / "fonts" / "frank-ruhl-libre-400.ttf"
# A PDF standard font, present in every reader, nothing to embed.
LATIN_FONT = "Helvetica"


class PdfUnavailable(RuntimeError):
    """ReportLab is not installed. The message is shown to the user."""


def _prepare(text: str) -> str:
    """Apply the bidi algorithm so a mixed line is drawn in visual order."""
    try:
        from bidi.algorithm import get_display
    except ImportError:
        return text
    try:
        return get_display(text)
    except Exception:
        return text


def _register_font() -> str:
    """Embed the Hebrew font. Falls back to Helvetica for Latin only documents."""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    if FONT_NAME in pdfmetrics.getRegisteredFontNames():
        return FONT_NAME
    if not FONT_FILE.is_file():
        return "Helvetica"
    try:
        pdfmetrics.registerFont(TTFont(FONT_NAME, str(FONT_FILE)))
        return FONT_NAME
    except Exception:
        return "Helvetica"


class _Writer:
    """A very small flowing text layout: margins, wrapping, and page breaks."""

    def __init__(self, path: Path, title: str = "") -> None:
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas

        self.font = _register_font()
        self.width, self.height = letter
        self.margin = 54
        self.leading = 17
        self.size = 11
        self.canvas = canvas.Canvas(str(path), pagesize=letter)
        self.canvas.setTitle(title or path.stem)
        self.y = self.height - self.margin

    def _space(self, needed: float) -> None:
        if self.y - needed < self.margin:
            self.canvas.showPage()
            self.y = self.height - self.margin

    # -- fonts -----------------------------------------------------------

    def _font_for(self, hebrew: bool) -> str:
        return self.font if hebrew else LATIN_FONT

    def _run_width(self, text: str, hebrew: bool, size: float) -> float:
        from reportlab.pdfbase.pdfmetrics import stringWidth

        return stringWidth(text, self._font_for(hebrew), size)

    def _text_width(self, text: str, size: float) -> float:
        return sum(self._run_width(t, h, size) for t, h in split_by_script(text))

    # -- drawing ---------------------------------------------------------

    def heading(self, text: str) -> None:
        self._space(self.leading * 2)
        self._draw_line(text, self.size + 5, rtl=is_hebrew(text))
        self.y -= self.leading * 0.6

    def paragraph(self, text: str, rtl: bool | None = None) -> None:
        if not text.strip():
            return
        if rtl is None:
            rtl = _mostly_hebrew(text)
        for line in self._wrap(text, self.size):
            self._space(self.leading)
            self._draw_line(line, self.size, rtl)
        self.y -= self.leading * 0.5

    def _draw_line(self, line: str, size: float, rtl: bool) -> None:
        """Draw one line run by run, each in a font that has its letters."""
        visual = _prepare(line)
        runs = split_by_script(visual)
        if not runs:
            self.y -= self.leading
            return

        total = sum(self._run_width(t, h, size) for t, h in runs)
        # Right aligned for Hebrew, which is where its reader starts.
        x = (self.width - self.margin - total) if rtl else self.margin

        for text, hebrew in runs:
            self.canvas.setFont(self._font_for(hebrew), size)
            self.canvas.drawString(x, self.y, text)
            x += self._run_width(text, hebrew, size)
        self.y -= self.leading

    def _wrap(self, text: str, size: float) -> list[str]:
        """Wrap to the margins, measuring each run in its own font."""
        limit = self.width - 2 * self.margin
        lines: list[str] = []
        for source in text.split("\n"):
            words = source.split()
            if not words:
                lines.append("")
                continue
            current = words[0]
            for word in words[1:]:
                candidate = f"{current} {word}"
                if self._text_width(candidate, size) <= limit:
                    current = candidate
                else:
                    lines.append(current)
                    current = word
            lines.append(current)
        return lines

    def save(self) -> None:
        self.canvas.save()


def _mostly_hebrew(text: str) -> bool:
    hebrew = sum(1 for c in text if is_hebrew(c))
    latin = sum(1 for c in text if c.isascii() and c.isalpha())
    return hebrew > latin


def _writer(path: Path, title: str) -> _Writer:
    try:
        import reportlab  # noqa: F401
    except ImportError as exc:
        raise PdfUnavailable(
            "PDF export needs the reportlab package, which is not installed. "
            "Export to TXT or Word instead."
        ) from exc
    return _Writer(path, title)


def write_transcript(
    corrected: CorrectedTranscript,
    path: Path | str,
    mode: OutputMode,
    policy: render.RenderPolicy | None = None,
    categories: dict[str, str] | None = None,
    title: str = "",
) -> Path:
    path = Path(path)
    policy = policy or render.RenderPolicy()
    writer = _writer(path, title or Path(corrected.transcript.source_path).stem)

    if title:
        writer.heading(title)
    for start, text in render.render_paragraphs(corrected, mode, policy, categories):
        if policy.include_timestamps:
            text = f"[{render.timestamp(start)}]  {text}"
        writer.paragraph(text)
    writer.save()
    return path


def write_document(document: Document, path: Path | str, title: str = "") -> Path:
    """An OCR result, one PDF page per source page, direction kept per block."""
    path = Path(path)
    writer = _writer(path, title or Path(document.source_path).stem)

    for position, page in enumerate(document.pages):
        if position:
            writer.canvas.showPage()
            writer.y = writer.height - writer.margin
        writer.heading(f"Page {page.page_number}")
        for block in sorted(page.blocks, key=lambda b: b.reading_order):
            if block.text.strip():
                writer.paragraph(block.text, rtl=block.direction == "rtl")
    writer.save()
    return path
