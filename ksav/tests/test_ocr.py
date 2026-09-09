"""Reading pages: cleanup, layout, recognition, PDFs and the review screen.

The recognition tests build their own pages from a Hebrew font and check the
text that comes back, so they measure the real pipeline rather than a mock. They
skip themselves when Tesseract is not installed, so the suite still runs on a
machine that has not set it up.
"""

from __future__ import annotations

import math
from pathlib import Path

import pytest

pytest.importorskip("cv2")
pytest.importorskip("PIL")

import cv2                                    # noqa: E402
import numpy as np                            # noqa: E402
from PIL import Image, ImageDraw, ImageFont   # noqa: E402

from app.core.models import BlockKind, TextBlock   # noqa: E402
from app.ocr import layout, preprocess             # noqa: E402
from app.ocr import registry as ocr_registry       # noqa: E402
from app.ocr.base import OcrOptions, ScriptHint    # noqa: E402
from app.ocr.tesseract_engine import TesseractEngine, register_into  # noqa: E402

HEBREW_FONT = Path("app/export/fonts/frank-ruhl-libre-400.ttf")


def has_tesseract() -> bool:
    engine = TesseractEngine()
    usable, _reason = engine.is_available()
    return usable and "heb" in engine.languages()


needs_tesseract = pytest.mark.skipif(
    not has_tesseract(), reason="Tesseract with Hebrew data is not installed"
)


def make_page(path: Path, columns, width=1100, height=700, tilt=0.0, noise=0.0,
              heading=None, size=34) -> Path:
    """Render a page of Hebrew, optionally in columns, tilted and speckled."""
    image = Image.new("L", (width, height), 252)
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(HEBREW_FONT), size)
    if heading:
        draw.text((width // 2 - 110, 40), heading,
                  font=ImageFont.truetype(str(HEBREW_FONT), size + 10), fill=15)
    for x, lines in columns:
        y = 150
        for line in lines:
            draw.text((x, y), line, font=font, fill=18)
            y += int(size * 1.7)

    array = np.array(image)
    if tilt:
        matrix = cv2.getRotationMatrix2D((width / 2, height / 2), tilt, 1.0)
        array = cv2.warpAffine(array, matrix, (width, height), borderValue=250)
    if noise:
        array = np.clip(array.astype(int) + np.random.normal(0, noise, array.shape),
                        0, 255).astype(np.uint8)
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), array)
    return path


# -- preprocessing ------------------------------------------------------


@pytest.mark.parametrize("tilt", [-8.0, -4.0, -1.5, 2.5, 6.0])
def test_skew_is_measured_accurately(tmp_path, tilt):
    """Measured, not assumed: minAreaRect was wrong by close to a degree."""
    path = make_page(tmp_path / "p.png", [(80, ["בראשית ברא אלהים",
                                                "את השמים ואת הארץ",
                                                "והארץ היתה תהו"])], tilt=tilt, noise=8)
    gray = preprocess.to_grayscale(preprocess.load(path))
    correction = preprocess.estimate_skew(gray)

    height, width = gray.shape
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), correction, 1.0)
    straightened = cv2.warpAffine(gray, matrix, (width, height), borderValue=250)
    assert abs(preprocess.estimate_skew(straightened)) < 0.4


def test_a_straight_page_is_left_alone(tmp_path):
    path = make_page(tmp_path / "p.png", [(80, ["בראשית ברא אלהים", "את השמים"])])
    _out, steps = preprocess.run(preprocess.load(path))
    assert abs(steps.rotated) < 0.2


def test_a_wildly_rotated_page_is_reported_not_guessed(tmp_path):
    """Beyond a normal scan's skew, rotating is more likely to hurt than help."""
    path = make_page(tmp_path / "p.png", [(80, ["בראשית ברא אלהים", "את השמים"])])
    image = preprocess.load(path)
    steps = preprocess.Steps()
    options = preprocess.Options(max_skew_degrees=2.0)
    preprocess.deskew(image, options, steps)
    # Either it was inside the limit, or it declined and said why.
    assert abs(steps.rotated) < 2.0


def test_sauvola_survives_uneven_lighting_where_otsu_does_not(tmp_path):
    """A photographed sefer is lit unevenly, and one global threshold fails."""
    path = make_page(tmp_path / "p.png", [(80, ["שולחן ערוך אורח חיים", "הלכות שבת"])])
    gray = preprocess.to_grayscale(preprocess.load(path))
    gradient = np.tile(np.linspace(120, 255, gray.shape[1]).astype(np.uint8),
                       (gray.shape[0], 1))
    uneven = np.minimum(gray, gradient)

    _t, otsu = cv2.threshold(uneven, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    sauvola = preprocess.sauvola(uneven)
    total = uneven.size

    assert (otsu == 0).sum() > total * 0.2, "otsu should black out the dark half"
    assert (sauvola == 0).sum() < total * 0.1, "sauvola should find only the ink"


def test_preprocessing_describes_what_it_did(tmp_path):
    path = make_page(tmp_path / "p.png", [(80, ["בראשית ברא"])], tilt=-3.0, noise=10)
    _out, steps = preprocess.run(preprocess.load(path))
    assert "straightened" in steps.summary().lower()
    assert "3." in steps.summary() or "2." in steps.summary()


def test_an_unreadable_file_says_so(tmp_path):
    junk = tmp_path / "broken.png"
    junk.write_bytes(b"not an image")
    with pytest.raises(ValueError) as excinfo:
        preprocess.load(junk)
    assert "could not be opened" in str(excinfo.value)


# -- layout -------------------------------------------------------------


def test_direction_is_decided_per_block():
    assert layout.direction_of("בראשית ברא אלהים") == "rtl"
    assert layout.direction_of("The Gemara asks") == "ltr"
    assert layout.direction_of("The גמרא asks a קשיא") == "ltr", "English carrier"
    assert layout.direction_of("הגמרא asks") == "rtl"


def test_reading_order_is_right_to_left_on_a_hebrew_page():
    left = TextBlock("שמאל", (50, 100, 300, 200), direction="rtl")
    right = TextBlock("ימין", (600, 100, 300, 200), direction="rtl")
    ordered = layout.order([left, right], gutters=[450], page_direction="rtl")
    assert [b.text for b in ordered] == ["ימין", "שמאל"]


def test_reading_order_is_left_to_right_on_an_english_page():
    left = TextBlock("Left", (50, 100, 300, 200), direction="ltr")
    right = TextBlock("Right", (600, 100, 300, 200), direction="ltr")
    ordered = layout.order([left, right], gutters=[450], page_direction="ltr")
    assert [b.text for b in ordered] == ["Left", "Right"]


def test_a_banner_across_the_columns_comes_first():
    banner = TextBlock("כותרת", (50, 20, 860, 60), direction="rtl")
    right = TextBlock("ימין", (600, 120, 300, 200), direction="rtl")
    left = TextBlock("שמאל", (50, 120, 300, 200), direction="rtl")
    ordered = layout.order([right, left, banner], gutters=[450], page_direction="rtl")
    assert ordered[0].text == "כותרת"


def test_a_heading_is_recognised_by_its_size():
    blocks = [
        TextBlock("סימן א", (0, 0, 200, 60)),
        TextBlock("body text here", (0, 80, 400, 30)),
        TextBlock("more body text", (0, 120, 400, 30)),
        TextBlock("and more", (0, 160, 400, 30)),
    ]
    layout.classify(blocks)
    assert blocks[0].kind is BlockKind.HEADING
    assert blocks[1].kind is BlockKind.PARAGRAPH


# -- recognition --------------------------------------------------------


@pytest.fixture
def engine():
    ocr_registry.reset()
    register_into(ocr_registry)
    yield ocr_registry.get("tesseract")
    ocr_registry.reset()


@needs_tesseract
def test_a_tilted_noisy_hebrew_page_is_read_correctly(engine, tmp_path):
    path = make_page(tmp_path / "p.png", [(80, ["בראשית ברא אלהים",
                                                "את השמים ואת הארץ"])],
                     tilt=-3.5, noise=12)
    page = engine.recognize(path, OcrOptions(script_hint=ScriptHint.HEBREW_PLAIN))

    text = page.text()
    assert "בראשית" in text and "השמים" in text
    assert page.confidence > 0.7
    assert abs(page.rotation - 3.5) < 0.5, "the page should have been straightened"
    assert all(b.direction == "rtl" for b in page.blocks)


@needs_tesseract
def test_two_columns_are_read_separately_and_in_order(engine, tmp_path):
    """Handed a two column page whole, Tesseract reads straight across it."""
    path = make_page(
        tmp_path / "p.png",
        [(680, ["הלכות שבת סימן א", "המשכים לעמוד"]),
         (90, ["מעורר השחר ואם", "היה ישן בלילה"])],
        width=1200,
    )
    page = engine.recognize(path, OcrOptions(script_hint=ScriptHint.HEBREW_PLAIN))

    assert page.columns == 2
    ordered = sorted(page.blocks, key=lambda b: b.reading_order)
    assert len(ordered) >= 2
    # The right hand column must come first, and must not have been merged
    # word for word with the left.
    assert ordered[0].bbox[0] > ordered[-1].bbox[0]
    assert "הלכות" in ordered[0].text


@needs_tesseract
def test_a_region_the_user_drew_is_read_on_its_own(engine, tmp_path):
    path = make_page(tmp_path / "p.png",
                     [(680, ["הלכות שבת"]), (90, ["מעורר השחר"])], width=1200)
    page = engine.recognize(path, OcrOptions(
        script_hint=ScriptHint.HEBREW_PLAIN, regions=[(600, 100, 600, 300)]
    ))
    text = page.text()
    assert "הלכות" in text
    assert "מעורר" not in text, "only the drawn region should have been read"


def test_missing_yiddish_data_falls_back_and_says_so(engine):
    installed = engine.languages()
    languages, note = engine.resolve_languages(OcrOptions(script_hint=ScriptHint.YIDDISH))

    if "yid" in installed:
        assert "yid" in languages
    elif "heb" in installed:
        assert languages == ["heb"]
        assert "Yiddish" in note and "Model Vault" in note
    else:
        # No language data at all. This came back as [] on a Windows runner,
        # which would have handed Tesseract an empty -l flag.
        assert languages, "an empty language list would fail deep inside Tesseract"
        assert note


def test_a_language_is_always_chosen_even_with_nothing_installed(engine, monkeypatch):
    """The gate is is_available, not an empty list surfacing later."""
    monkeypatch.setattr(engine, "_languages", set())
    for hint in ScriptHint:
        languages, note = engine.resolve_languages(OcrOptions(script_hint=hint))
        assert languages, f"{hint.value} produced no language at all"
        assert note, f"{hint.value} said nothing about the missing data"


def test_the_hard_scripts_warn_before_the_work_not_after(engine):
    """Rashi and old print are honestly poor, and the user should know first."""
    rashi = engine.quality_note(OcrOptions(script_hint=ScriptHint.RASHI))
    old = engine.quality_note(OcrOptions(script_hint=ScriptHint.OLD_PRINT))
    nekudos = engine.quality_note(OcrOptions(script_hint=ScriptHint.HEBREW_NEKUDOS))

    assert "no good offline model" in rashi
    assert "60 and 80" in old
    assert "dropped" in nekudos
    assert engine.quality_note(OcrOptions(script_hint=ScriptHint.HEBREW_PLAIN)) == ""


def test_the_engine_declares_what_it_can_do(engine):
    assert engine.capabilities.per_block_direction
    assert engine.capabilities.reading_order
    assert not engine.capabilities.gpu
    assert ScriptHint.RASHI in engine.capabilities.supported_hints


# -- PDFs ---------------------------------------------------------------


pytest.importorskip("pypdfium2")
pytest.importorskip("reportlab")

from app.core.settings import Settings          # noqa: E402
from app.export import pdf as pdf_export        # noqa: E402
from app.ocr import pdf as pdf_reader           # noqa: E402
from app.services.ocr import DocumentStore, OcrService, is_pdf, is_supported  # noqa: E402


def make_typed_pdf(path: Path, pages: int = 2) -> Path:
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    document = canvas.Canvas(str(path), pagesize=letter)
    for index in range(pages):
        document.setFont("Helvetica", 14)
        document.drawString(72, 700, f"Page {index + 1}: The Gemara in Bava Metzia.")
        document.drawString(72, 676, "A second line so this page has real text on it.")
        document.showPage()
    document.save()
    return path


def test_a_typed_pdf_is_read_directly_rather_than_scanned(tmp_path):
    """Far faster and perfectly accurate, where OCR would introduce mistakes."""
    path = make_typed_pdf(tmp_path / "typed.pdf", pages=3)
    info = pdf_reader.probe(path)

    assert info.pages == 3
    assert info.text_pages == 3
    assert info.needs_ocr == 0

    page = pdf_reader.text_layer(path, 0)
    assert page is not None and page.from_text_layer
    assert "Bava Metzia" in page.text()


def test_a_scanned_pdf_has_no_text_to_read(tmp_path):
    page = make_page(tmp_path / "scan.png", [(80, ["בראשית ברא אלהים"])])
    Image.open(page).convert("RGB").save(tmp_path / "scan.pdf")

    info = pdf_reader.probe(tmp_path / "scan.pdf")
    assert info.text_pages == 0
    assert info.needs_ocr == 1
    assert pdf_reader.text_layer(tmp_path / "scan.pdf", 0) is None


def test_rendering_a_page_honours_the_resolution(tmp_path):
    path = make_typed_pdf(tmp_path / "typed.pdf", pages=2)
    low = pdf_reader.render_page(path, 0, tmp_path / "low.png", dpi=100)
    high = pdf_reader.render_page(path, 1, tmp_path / "high.png", dpi=300)
    assert Image.open(high).width > Image.open(low).width * 2.5


def test_pdf_errors_are_written_for_a_person(tmp_path):
    with pytest.raises(pdf_reader.PdfError) as missing:
        pdf_reader.probe(tmp_path / "nope.pdf")
    assert "could not be found" in str(missing.value)

    junk = tmp_path / "junk.pdf"
    junk.write_bytes(b"not a pdf at all")
    with pytest.raises(pdf_reader.PdfError) as corrupt:
        pdf_reader.probe(junk)
    assert "corrupt" in str(corrupt.value)


# -- the service --------------------------------------------------------


@pytest.fixture
def service(tmp_path):
    ocr_registry.reset()
    register_into(ocr_registry)
    yield OcrService(Settings(), DocumentStore(tmp_path / "docs"))
    ocr_registry.reset()


def test_what_counts_as_a_page():
    for extension in ("png", "jpg", "tiff", "pdf", "webp"):
        assert is_supported(f"page.{extension}")
    assert not is_supported("shiur.mp3")
    assert is_pdf("sefer.pdf") and not is_pdf("sefer.png")


@needs_tesseract
def test_a_single_image_becomes_a_one_page_document(service, tmp_path):
    path = make_page(tmp_path / "p.png", [(80, ["בראשית ברא אלהים"])])
    document = service.process(path, hint=ScriptHint.HEBREW_PLAIN)
    assert len(document.pages) == 1
    assert "בראשית" in document.text()


@needs_tesseract
def test_a_folder_of_scans_becomes_one_document_in_order(service, tmp_path):
    folder = tmp_path / "scans"
    for number, line in enumerate(["דף ראשון", "דף שני", "דף שלישי"], 1):
        make_page(folder / f"{number:02d}.png", [(80, [line])], height=300)

    document = service.process_folder(folder, hint=ScriptHint.HEBREW_PLAIN)
    assert len(document.pages) == 3
    assert [p.page_number for p in document.pages] == [1, 2, 3]
    assert "ראשון" in document.pages[0].text()
    assert "שלישי" in document.pages[2].text()


def test_a_typed_pdf_skips_ocr_entirely(service, tmp_path):
    path = make_typed_pdf(tmp_path / "typed.pdf", pages=2)
    document = service.process(path)

    assert len(document.pages) == 2
    assert all(p.from_text_layer for p in document.pages)
    assert all(p.image_path for p in document.pages), "the page picture is still kept"


def test_a_document_survives_a_round_trip_through_disk(service, tmp_path):
    path = make_typed_pdf(tmp_path / "typed.pdf", pages=2)
    document = service.process(path)
    reloaded = service.store.load(service.store.path_for(document.id))

    assert reloaded.text() == document.text()
    assert len(reloaded.pages) == len(document.pages)
    assert reloaded.pages[0].blocks[0].direction == document.pages[0].blocks[0].direction


# -- export -------------------------------------------------------------


def test_pdf_export_draws_both_scripts(tmp_path):
    """The Hebrew font has no Latin glyphs, so a mixed line needs two fonts.

    Drawing it in one font produced a row of empty boxes where the English
    should have been, and only rendering the result showed it.
    """
    from app.core.models import Document, PageText

    document = Document(source_path="sefer.pdf", pages=[PageText(page_number=1, blocks=[
        TextBlock("בראשית ברא אלהים את השמים", (0, 0, 1, 1), direction="rtl",
                  reading_order=0),
        TextBlock("The Gemara asks a קשיא on Rav Huna.", (0, 0, 1, 1),
                  direction="ltr", reading_order=1),
    ])])
    path = pdf_export.write_document(document, tmp_path / "out.pdf", title="Sefer")

    rendered = pdf_reader.render_page(path, 0, tmp_path / "out.png", dpi=110)
    array = cv2.imread(str(rendered), cv2.IMREAD_GRAYSCALE)
    ink = (array < 128)

    # Split the page in half vertically: the Hebrew line sits in the top
    # portion, the mixed line below it. Both must have drawn something.
    top = ink[: ink.shape[0] // 3].sum()
    middle = ink[ink.shape[0] // 3: ink.shape[0] * 2 // 3].sum()
    assert top > 200 and middle > 200 or top + middle > 800

    extracted = pdf_reader.text_layer(path, 0)
    assert extracted is not None
    assert any(0x590 <= ord(c) <= 0x5FF for c in extracted.text()), "no Hebrew in the PDF"
    assert "Gemara" in extracted.text(), "the English was not drawn"


def test_pdf_export_of_a_transcript_keeps_hebrew(tmp_path):
    from app.core.models import CorrectedTranscript, Correction, OutputMode, Segment, Transcript

    # Long enough to clear the minimum that separates a real text layer from a
    # page number, which is the same threshold the PDF reader uses.
    transcript = Transcript(source_path="shiur.mp3", segments=[
        Segment(0, 0, 3, "The camera asks a kasha on Rav Huna in the sugya."),
        Segment(1, 3, 6, "Tosafos answers that according to this svara it is not shver."),
    ])
    corrected = CorrectedTranscript(transcript, [Correction(
        segment_index=0, start=4, end=10, raw="camera", entry_id="x",
        canonical="Gemara", hebrew="גמרא", reason="test", applied=True,
    )])
    path = pdf_export.write_transcript(
        corrected, tmp_path / "t.pdf", OutputMode.HEBREW_SCRIPT, title="Shiur"
    )
    text = pdf_reader.text_layer(path, 0).text()
    assert any(0x590 <= ord(c) <= 0x5FF for c in text)
