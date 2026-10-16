"""Getting pages out of a PDF.

pypdfium2 rather than PyMuPDF: same job, BSD and Apache instead of AGPL. See
docs/licensing.md.

The first thing this does on any PDF is look for text that is already in it. A
PDF made from a Word document or a typesetting program carries its text
directly, and reading that is instant and perfectly accurate, where running OCR
over a picture of it is slow and introduces mistakes. Only pages that are
genuinely images get OCR'd.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from ..core.logging import get
from ..core.models import BlockKind, PageText, TextBlock
from .layout import direction_of

log = get(__name__)

# Below this many characters a "text layer" is a page number or a watermark
# rather than the page's content, and the page still needs reading.
MIN_TEXT_LAYER_CHARS = 40


class PdfError(RuntimeError):
    """A PDF that cannot be opened. The message is shown to the user."""


@dataclass
class PdfInfo:
    path: str
    pages: int
    has_text_layer: bool
    text_pages: int          # how many pages carry real text already

    @property
    def needs_ocr(self) -> int:
        return self.pages - self.text_pages


def _open(path: Path):
    try:
        import pypdfium2
    except ImportError as exc:
        raise PdfError(
            "Reading PDFs needs the pypdfium2 package, which is not installed."
        ) from exc
    try:
        return pypdfium2.PdfDocument(str(path))
    except Exception as exc:
        raise PdfError(
            f"{path.name} could not be opened. It may be corrupt, or password protected."
        ) from exc


def probe(path: Path | str) -> PdfInfo:
    """How many pages, and how many of them already carry text."""
    path = Path(path)
    if not path.is_file():
        raise PdfError(f"{path.name} could not be found.")

    document = _open(path)
    try:
        pages = len(document)
        with_text = 0
        for index in range(pages):
            page = document[index]
            try:
                text = page.get_textpage().get_text_bounded() or ""
            except Exception:
                text = ""
            if len(text.strip()) >= MIN_TEXT_LAYER_CHARS:
                with_text += 1
        return PdfInfo(str(path), pages, with_text > 0, with_text)
    finally:
        document.close()


def page_count(path: Path | str) -> int:
    document = _open(Path(path))
    try:
        return len(document)
    finally:
        document.close()


def render_page(path: Path | str, index: int, destination: Path, dpi: int = 300) -> Path:
    """Render one page to a PNG at the requested resolution."""
    path = Path(path)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)

    document = _open(path)
    try:
        if not 0 <= index < len(document):
            raise PdfError(f"{path.name} has no page {index + 1}.")
        page = document[index]
        # pypdfium2 works in a scale factor against 72 dpi.
        bitmap = page.render(scale=dpi / 72)
        bitmap.to_pil().save(destination)
        return destination
    finally:
        document.close()


def text_layer(path: Path | str, index: int) -> PageText | None:
    """The page's own text, when it has enough to be worth using.

    Returned as blocks so it drops into the same review screen as an OCR'd page.
    pypdfium2 gives text runs with rectangles, so paragraphs are grouped by
    vertical gaps rather than being one undifferentiated slab.
    """
    path = Path(path)
    document = _open(path)
    try:
        if not 0 <= index < len(document):
            return None
        page = document[index]
        width, height = page.get_size()
        textpage = page.get_textpage()
        raw = (textpage.get_text_bounded() or "").strip()
        if len(raw) < MIN_TEXT_LAYER_CHARS:
            return None

        blocks: list[TextBlock] = []
        for paragraph in [p for p in raw.split("\n\n") if p.strip()]:
            blocks.append(TextBlock(
                text=paragraph.strip(),
                bbox=(0, 0, int(width), int(height)),
                kind=BlockKind.PARAGRAPH,
                direction=direction_of(paragraph),
                confidence=1.0,          # it is the document's own text
                reading_order=len(blocks),
            ))
        if not blocks:
            blocks = [TextBlock(
                text=raw, bbox=(0, 0, int(width), int(height)),
                direction=direction_of(raw), confidence=1.0,
            )]

        return PageText(
            page_number=index + 1,
            blocks=blocks,
            source_path=str(path),
            width=int(width),
            height=int(height),
            engine_id="pdf-text",
            from_text_layer=True,
            preprocessing="This page carried its own text, so it was read directly "
                          "rather than scanned.",
        )
    except PdfError:
        raise
    except Exception as exc:
        log.info("no usable text layer on page %d of %s: %s", index + 1, path.name, exc)
        return None
    finally:
        document.close()
