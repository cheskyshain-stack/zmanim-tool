"""Getting pages onto paper, or into a PDF.

Both go through the same painter, so what prints and what is saved cannot drift apart. The
page size is fixed by the program rather than left to the print dialog: the chart is
landscape and the week card is portrait, and a dialog that opened the other way round would
quietly produce a wrong page.
"""
from contextlib import contextmanager

from PySide6.QtCore import QMarginsF
from PySide6.QtGui import QPageLayout, QPageSize, QPainter, QPdfWriter
from PySide6.QtPrintSupport import QPrinter

from . import theme

# Enough for a printed board to look printed rather than rasterised, without making a PDF
# of a whole season unwieldy.
PDF_RESOLUTION = 300


def _layout(landscape: bool) -> tuple:
    orientation = QPageLayout.Landscape if landscape else QPageLayout.Portrait
    return QPageSize(QPageSize.Letter), orientation


def page_image(paint_one, width_in: float, height_in: float, dpi: int = 110):
    """One page drawn into an image, for showing on screen.

    The same painter draws it as draws the paper, at a lower resolution: a preview that went
    through a second, screen-only renderer would be a second thing to keep in step, and the
    whole bargain of this program is that what is on the screen is what comes out.
    """
    from PySide6.QtGui import QImage, QPainter

    image = QImage(round(width_in * dpi), round(height_in * dpi), QImage.Format_RGB32)
    image.setDotsPerMeterX(round(dpi / 0.0254))
    image.setDotsPerMeterY(round(dpi / 0.0254))
    image.fill(0xFFFFFFFF)
    painter = QPainter(image)
    painter.setRenderHint(QPainter.Antialiasing, True)
    painter.setRenderHint(QPainter.TextAntialiasing, True)
    try:
        paint_one(painter)
    finally:
        painter.end()
    return image


@contextmanager
def pdf_painter(path: str, landscape: bool, resolution: int = PDF_RESOLUTION):
    writer = QPdfWriter(path)
    size, orientation = _layout(landscape)
    writer.setPageSize(size)
    writer.setPageOrientation(orientation)
    writer.setPageMargins(QMarginsF(0, 0, 0, 0))
    writer.setResolution(resolution)
    painter = QPainter(writer)
    try:
        yield writer, painter
    finally:
        painter.end()


@contextmanager
def printer_painter(printer: QPrinter, landscape: bool):
    size, orientation = _layout(landscape)
    printer.setPageSize(size)
    printer.setPageOrientation(orientation)
    printer.setPageMargins(QMarginsF(0, 0, 0, 0))
    painter = QPainter(printer)
    try:
        yield printer, painter
    finally:
        painter.end()


def paint_pages(writer, painter, pages, paint_one):
    """Draws a run of pages, starting a new sheet between each.

    newPage() comes before each page after the first rather than after each, so the run
    never ends with an empty sheet. A trailing blank page is the single most common way a
    printed run goes wrong.
    """
    for index, page in enumerate(pages):
        if index:
            writer.newPage()
        paint_one(painter, page)


def write_card_pdf(path: str, cards, chrome, font_family="Times New Roman", resolution: int = PDF_RESOLUTION):
    """Every week card in a run, portrait, at its real size."""
    from .card import CardPainter

    with pdf_painter(path, landscape=False, resolution=resolution) as (writer, painter):
        def one(p, card):
            CardPainter(p, chrome, font_family).paint(card)
        paint_pages(writer, painter, cards, one)
    return path


def write_chart_pdf(path: str, pages, style, chrome, resolution: int = PDF_RESOLUTION):
    """Every page of a chart, landscape, at its real size."""
    from .chart import ChartPainter

    with pdf_painter(path, landscape=True, resolution=resolution) as (writer, painter):
        def one(p, page):
            ChartPainter(p, style, chrome).paint(page)
        paint_pages(writer, painter, pages, one)
    return path
