"""Turning images, PDFs and folders of scans into text.

The one decision worth stating: a PDF page that already carries its own text is
read directly rather than photographed and OCR'd. That is instant and perfectly
accurate where OCR is slow and introduces mistakes, and a surprising number of
the PDFs people actually have are typed rather than scanned.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from ..core import paths
from ..core.logging import get
from ..core.models import BlockKind, Document, PageText, TextBlock
from ..ocr import pdf as pdf_reader
from ..ocr import registry as ocr_registry
from ..ocr.base import OcrOptions, ScriptHint
from ..ocr.preprocess import load as load_image

log = get(__name__)

IMAGE_EXTENSIONS = ("png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp", "heic", "gif")
PDF_EXTENSIONS = ("pdf",)
SUPPORTED_EXTENSIONS = IMAGE_EXTENSIONS + PDF_EXTENSIONS


def is_supported(path: Path | str) -> bool:
    return Path(path).suffix.lower().lstrip(".") in SUPPORTED_EXTENSIONS


def is_pdf(path: Path | str) -> bool:
    return Path(path).suffix.lower().lstrip(".") in PDF_EXTENSIONS


class DocumentStore:
    """OCR results on disk, one JSON file each, beside the page images."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root) if root else paths.data_root() / "documents"
        self.root.mkdir(parents=True, exist_ok=True)

    def path_for(self, document_id: str) -> Path:
        return self.root / f"{document_id}.json"

    def pages_dir(self, document_id: str) -> Path:
        directory = self.root / document_id
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    def save(self, document: Document) -> Path:
        path = self.path_for(document.id)
        payload = asdict(document)
        for page in payload["pages"]:
            for block in page["blocks"]:
                block["kind"] = block["kind"].value if hasattr(block["kind"], "value") \
                    else block["kind"]
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
        return path

    def load(self, path: Path | str) -> Document:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        pages = []
        for raw in data.get("pages", []):
            blocks = [
                TextBlock(
                    text=b["text"],
                    bbox=tuple(b["bbox"]),
                    kind=BlockKind(b.get("kind", "paragraph")),
                    direction=b.get("direction", "rtl"),
                    confidence=b.get("confidence", 0.0),
                    reading_order=b.get("reading_order", 0),
                    language=b.get("language"),
                )
                for b in raw.get("blocks", [])
            ]
            page = PageText(
                page_number=raw.get("page_number", 1),
                blocks=blocks,
                image_path=raw.get("image_path", ""),
                source_path=raw.get("source_path", ""),
                width=raw.get("width", 0),
                height=raw.get("height", 0),
                engine_id=raw.get("engine_id", ""),
                rotation=raw.get("rotation", 0.0),
                from_text_layer=raw.get("from_text_layer", False),
                columns=raw.get("columns", 1),
                preprocessing=raw.get("preprocessing", ""),
                notes=raw.get("notes", []),
            )
            pages.append(page)
        return Document(
            id=data.get("id", ""),
            source_path=data.get("source_path", ""),
            pages=pages,
            created_at=data.get("created_at", ""),
        )

    def list(self) -> list[Path]:
        return sorted(self.root.glob("*.json"),
                      key=lambda p: p.stat().st_mtime, reverse=True)


class OcrService:
    """One call from the job queue to a finished document."""

    def __init__(self, settings, store: DocumentStore | None = None,
                 manager=None) -> None:
        self.settings = settings
        self.store = store or DocumentStore()
        self._manager = manager

    # -- options ---------------------------------------------------------

    def options_for(self, hint: ScriptHint | None = None) -> OcrOptions:
        ocr = self.settings.ocr
        return OcrOptions(
            languages=list(ocr.languages),
            script_hint=hint or ScriptHint.AUTO,
            preprocess=ocr.preprocess,
            deskew=ocr.deskew,
            denoise=ocr.denoise,
            auto_orient=ocr.auto_orient,
            detect_columns=ocr.detect_columns,
            dpi=ocr.dpi,
        )

    def engine(self):
        engine = ocr_registry.get(self.settings.ocr.engine_id)
        if self._manager is None or not hasattr(engine, "_tessdata"):
            return engine

        # Only redirect Tesseract when the vault actually holds language data.
        # Pointing it at an empty folder hides the data that shipped with it,
        # and the symptom is "Tesseract is installed but has no language data"
        # on a machine where it plainly does.
        installed = self._manager.installed_ocr_languages()
        if installed:
            engine._tessdata = self._manager.tessdata_dir().parent
        else:
            engine._tessdata = None
        engine._languages = None           # re-read after an install or removal
        return engine

    def page_count(self, source: Path | str) -> int:
        source = Path(source)
        if is_pdf(source):
            return pdf_reader.page_count(source)
        return 1

    # -- the work --------------------------------------------------------

    def process(
        self,
        source: Path | str,
        *,
        hint: ScriptHint | None = None,
        on_progress=None,
        should_cancel=None,
    ) -> Document:
        source = Path(source)
        document = Document(source_path=str(source))
        options = self.options_for(hint)
        engine = self.engine()
        pages_dir = self.store.pages_dir(document.id)

        if is_pdf(source):
            total = pdf_reader.page_count(source)
            for index in range(total):
                if should_cancel and should_cancel():
                    break
                if on_progress:
                    on_progress(index, total, f"Page {index + 1} of {total}")

                page = None
                if self.settings.ocr.use_pdf_text_layer:
                    page = pdf_reader.text_layer(source, index)
                if page is not None:
                    # Still render the picture, so the review screen can show
                    # the page beside its text.
                    image = pages_dir / f"page-{index + 1:04d}.png"
                    try:
                        pdf_reader.render_page(source, index, image, options.dpi)
                        page.image_path = str(image)
                    except pdf_reader.PdfError:
                        pass
                else:
                    image = pdf_reader.render_page(
                        source, index, pages_dir / f"page-{index + 1:04d}.png", options.dpi
                    )
                    page = engine.recognize(image, options, should_cancel=should_cancel)
                    page.page_number = index + 1
                    page.source_path = str(source)
                document.pages.append(page)
            if on_progress:
                on_progress(total, total, "Finished")
        else:
            if on_progress:
                on_progress(0, 1, source.name)
            page = engine.recognize(source, options, should_cancel=should_cancel)
            page.page_number = 1
            document.pages.append(page)
            if on_progress:
                on_progress(1, 1, "Finished")

        self.store.save(document)
        return document

    def process_folder(
        self,
        folder: Path | str,
        *,
        hint: ScriptHint | None = None,
        on_progress=None,
        should_cancel=None,
    ) -> Document:
        """A folder of scans read as one document, in filename order."""
        folder = Path(folder)
        images = sorted(p for p in folder.rglob("*")
                        if p.is_file() and is_supported(p) and not is_pdf(p))
        document = Document(source_path=str(folder))
        options = self.options_for(hint)
        engine = self.engine()

        for index, image in enumerate(images):
            if should_cancel and should_cancel():
                break
            if on_progress:
                on_progress(index, len(images), f"{image.name} ({index + 1} of {len(images)})")
            page = engine.recognize(image, options, should_cancel=should_cancel)
            page.page_number = index + 1
            page.source_path = str(image)
            document.pages.append(page)

        if on_progress:
            on_progress(len(images), len(images), "Finished")
        self.store.save(document)
        return document

    # -- the job queue runner --------------------------------------------

    def make_runner(self):
        def run(job, progress, cancelled) -> str:
            source = Path(job.source_path)
            hint_value = job.options.get("script_hint")
            hint = ScriptHint(hint_value) if hint_value else None

            if source.is_dir():
                document = self.process_folder(
                    source, hint=hint,
                    on_progress=lambda done, total, message: progress(done, total, message),
                    should_cancel=cancelled,
                )
            else:
                document = self.process(
                    source, hint=hint,
                    on_progress=lambda done, total, message: progress(done, total, message),
                    should_cancel=cancelled,
                )
            return str(self.store.path_for(document.id))

        return run
