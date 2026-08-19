"""How a sheet is shown: fitting it to the window, and the two charts side by side.

Measured in pixels off the widgets that are really on the screen, not from the flags that
were set. "Fit to screen" means a whole page is across the window; the honest way to check
that is to ask how wide the page came out and how wide the window is.

    python3 desktop/tests/test_sheet_view.py
"""
import os
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "desktop"))

# A Windows console writes cp1252, and every test name here is in Hebrew. Without this, a run
# where every single check passed still ends non-zero, on the print at the end rather than on
# anything it measured. errors="replace" is for the underline sentinels, U+E000 and U+E001,
# which are private use characters with no glyph in any font.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from PySide6.QtCore import QPointF  # noqa: E402
from PySide6.QtGui import QColor  # noqa: E402
from PySide6.QtWidgets import QApplication, QColorDialog  # noqa: E402

_app = QApplication.instance() or QApplication([])

from zmanimboard import sheets as sheetlib  # noqa: E402
from zmanimboard.app import PREVIEW_DPI, Window  # noqa: E402
from zmanimboard.render import theme  # noqa: E402
from zmanimboard.render.output import chart_preview  # noqa: E402


class Report:
    def __init__(self):
        self.rows = []
        self.failed = False

    def expect(self, name, ok, detail=""):
        self.rows.append((name, bool(ok), detail))
        if not ok:
            self.failed = True

    def equal(self, name, want, got):
        self.expect(name, want == got, "" if want == got else f"\n      want {want!r}\n      got  {got!r}")

    def summary(self):
        width = max(len(n) for n, _, _ in self.rows)
        for name, ok, detail in self.rows:
            print(f"  {'ok  ' if ok else 'FAIL'} {name.ljust(width)}  {detail}")
        print(f"\n  {sum(1 for _, ok, _ in self.rows if ok)} of {len(self.rows)} checks passed.")
        return not self.failed


R = Report()

FULL_SIZE = round(theme.CHART.width * PREVIEW_DPI)   # a page at its real preview size, 11in


def settle(ms=500):
    """Let Qt finish laying out and let the refit timer fire. The pages are redrawn from the
    width of the area they are shown in, and that width is not final the instant a resize is
    asked for."""
    end = time.time() + ms / 1000
    while time.time() < end:
        _app.processEvents()


with tempfile.TemporaryDirectory() as tmp:
    folder = Path(tmp)
    window = Window(folder)
    window.resize(1200, 860)
    window.show()
    settle()

    generate = window.screens["generate"]
    generate.choref.setChecked(True)
    generate.year.setValue(5787)
    generate.refresh()
    generate.generate()
    settle()

    screen = window.sheet_screen

    def page_width(row=0, col=0):
        item = screen.pages_layout.itemAtPosition(row, col)
        return item.widget().pixmap().width() if item and item.widget() else None

    def viewport():
        return screen.scroll.viewport().width()

    # --- fitting -----------------------------------------------------------------------------
    # A page is 11 inches across, so at any usual window size the chart can only be read a
    # column at a time. Fitting starts on by itself when a page does not fit.
    R.expect("a page does not fit in this window at its real size", FULL_SIZE > viewport(),
             f"{FULL_SIZE}px page, {viewport()}px of room")
    R.expect("so the sheet opens fitted", screen.fit, "")
    R.expect("and the button shows it", screen.fit_button.isChecked(), "")
    R.expect("a whole page is across the window", page_width() <= viewport(),
             f"{page_width()}px page, {viewport()}px of room")
    R.expect("and it uses the room it has", page_width() > viewport() - 80,
             f"{page_width()}px page, {viewport()}px of room")

    # This is what makes the page readable rather than merely small: fitting redraws at a
    # lower resolution, so the cell map is drawn in the same run and a click still lands.
    preview = screen.pages_layout.itemAtPosition(0, 0).widget()
    R.equal("a fitted page still maps every cell", 80, len(preview.cells))
    R.expect("and the cells are inside the fitted page",
             all(rect.right() <= preview.pixmap().width() + 1 for rect, _s, _k in preview.cells), "")

    screen.set_fit(False)
    settle(200)
    R.equal("turning fitting off draws the page at its real size", FULL_SIZE, page_width())

    screen.set_fit(True)
    settle()
    R.expect("and back on it fits again", page_width() <= viewport(), f"{page_width()} vs {viewport()}")

    # Widening the window refits: how far down to scale is worked out from the width of the
    # area the pages are in, and that changes every time the window is dragged.
    window.resize(1700, 900)
    settle(700)
    R.expect("widening the window redraws bigger", page_width() > 1000, f"{page_width()}px")
    R.equal("but never past the page's real size", FULL_SIZE, min(page_width(), FULL_SIZE))
    R.expect("still inside the window", page_width() <= viewport(), f"{page_width()} vs {viewport()}")

    window.resize(1200, 860)
    settle(700)
    R.expect("narrowing it again scales back down", page_width() <= viewport(),
             f"{page_width()} vs {viewport()}")

    # --- side by side --------------------------------------------------------------------------
    # The point of it is checking the two charts against each other, so page 1 of this sheet
    # has to sit beside page 1 of the other one, pair per row.
    companion = sheetlib.companion_of(screen.sheet, window.state["sheets"])
    R.expect("this sheet has a weekday chart to sit beside", bool(companion), "")
    R.expect("so the button is offered", screen.beside_button.isVisible(), "")

    screen.set_side_by_side(True)
    settle()
    rows = screen.pages_layout.rowCount()
    R.equal("every page gets a row", 3, rows)
    R.expect("with something in both columns of each",
             all(screen.pages_layout.itemAtPosition(r, c) for r in range(rows) for c in (0, 1)), "")

    together = page_width(0, 0) + page_width(0, 1)
    R.expect("and the pair fits across the window", together <= viewport(),
             f"{together}px for the pair, {viewport()}px of room")
    R.equal("both drawn at the same size", page_width(0, 0), page_width(0, 1))

    # Not just "a second picture": it has to be the other chart's matching page. Drawn again
    # here from the companion sheet and compared pixel for pixel.
    other_pages = sheetlib.chart_pages(companion, window.state, window.settings,
                                       sheetlib.merged_shacharis_html(window.state["settings"]))
    dpi = screen._preview_dpi(2)
    same = []
    for index in range(rows):
        drawn, _cells = chart_preview(other_pages[index], sheetlib.style_of(companion),
                                      sheetlib.chrome_of(window.state["settings"], True), dpi)
        same.append(screen.pages_layout.itemAtPosition(index, 1).widget().pixmap().toImage() == drawn)
    R.equal("each row holds the weekday page that matches it", [True, True, True], same)

    # The page beside belongs to another sheet, so typing in it here would put the edit on the
    # wrong chart. It is handed no cells at all.
    beside = screen.pages_layout.itemAtPosition(0, 1).widget()
    R.equal("the chart beside is not typed in", [], beside.cells)
    landed = []
    beside.clicked.connect(lambda s, k: landed.append((s, k)))
    beside.mousePressEvent(type("Event", (), {"position": lambda self=None: QPointF(100, 100)})())
    R.equal("clicking it edits nothing", [], landed)

    screen.set_side_by_side(False)
    settle(200)
    R.equal("turning it off leaves one column", None, page_width(0, 1))

    # A sheet with no companion has nothing to sit beside, so the button is not there. Both
    # the recorded pairing and the season and year fallback have to be broken for it to
    # really have none: companion_of falls back to linkedSeason plus the year.
    #
    # Turned back on first, or the check below that it does not stay on would pass without
    # anything having to switch it off.
    screen.set_side_by_side(True)
    settle(300)
    R.expect("side by side is on again before the next check", screen.side_by_side, "")

    lone = dict(companion, id="lone", linkedSheetId=None, linkedSeason=None, hebrewYear=5999)
    window.state["sheets"].append(lone)
    window.open_sheet(lone)
    settle(300)
    R.expect("a sheet with no companion is not offered the button", not screen.beside_button.isVisible(), "")
    R.expect("and is not left in side by side", not screen.side_by_side, "")
    R.equal("so it is shown in one column", None, page_width(0, 1))
    window.state["sheets"].remove(lone)

    # --- pages left out of the print -----------------------------------------------------------
    window.open_sheet(window.state["sheets"][0])
    settle()
    R.equal("back on a three page sheet", 3, len(screen.page_boxes))
    screen.page_boxes[1].setChecked(False)
    settle(100)

    def opacity(row):
        effect = screen.pages_layout.itemAtPosition(row, 0).widget().graphicsEffect()
        return round(effect.opacity(), 2) if effect else 1.0

    # Left out of the print is not the same as not wanting to see it: a dropped page stays on
    # the screen, dimmed, so it can still be read.
    R.equal("a page left out is dimmed, not hidden", [1.0, 0.35, 1.0], [opacity(r) for r in range(3)])
    R.equal("and it is still on the screen", 3, screen.pages_layout.rowCount())

    screen.page_boxes[1].setChecked(True)
    settle(100)
    R.equal("ticking it back undims it", [1.0, 1.0, 1.0], [opacity(r) for r in range(3)])

    # --- the page colour ---------------------------------------------------------------------
    # QColorDialog was used here without being imported, so pressing the button raised a
    # NameError instead of opening anything. The dialog is replaced rather than opened: a
    # modal window with nobody to answer it would hang the run.
    asked = []
    original = QColorDialog.getColor

    def fake_colour(initial=None, parent=None, title=""):
        asked.append(initial.name() if isinstance(initial, QColor) else None)
        return QColor("#ffd9a0")

    QColorDialog.getColor = staticmethod(fake_colour)
    try:
        screen.pick_colour()
    finally:
        QColorDialog.getColor = original

    R.equal("the colour button opens on the colour the sheet has", 1, len(asked))
    R.equal("and the colour chosen reaches the sheet", "#ffd9a0", screen.sheet["style"]["accentColor"])

sys.exit(0 if R.summary() else 1)
