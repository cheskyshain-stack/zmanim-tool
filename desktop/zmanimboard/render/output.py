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


def write_chart_pdf(path: str, pages, style, chrome, resolution: int = PDF_RESOLUTION):
    """Every page of a chart, landscape, at its real size."""
    from .chart import ChartPainter

    with pdf_painter(path, landscape=True, resolution=resolution) as (writer, painter):
        def one(p, page):
            ChartPainter(p, style, chrome).paint(page)
        paint_pages(writer, painter, pages, one)
    return path
