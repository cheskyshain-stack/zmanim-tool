"""Typing over a cell on a sheet, and the style controls.

Driven through the screen rather than around it: a click lands on a real cell, the dialog
takes a value, and the page is checked afterwards for what actually printed.

    python3 desktop/tests/test_editor.py
"""
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "desktop"))

# A Windows console writes cp1252, and every test name here is in Hebrew. Without this, a run
# where every single check passed still ends non-zero, on the print at the end rather than on
# anything it measured. errors="replace" is for the underline sentinels, U+E000 and U+E001,
# which are private use characters with no glyph in any font.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import fitz  # noqa: E402
from PySide6.QtCore import QPointF  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

_app = QApplication.instance() or QApplication([])

from zmanimboard import sheets as sheetlib, state as statelib  # noqa: E402
from zmanimboard.app import Window  # noqa: E402
from zmanimboard.celldialog import CellDialog  # noqa: E402
from zmanimboard.render.output import chart_preview, write_chart_pdf  # noqa: E402
from zmanimboard.render.richtext import engine_text_to_html  # noqa: E402


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

with tempfile.TemporaryDirectory() as tmp:
    folder = Path(tmp)
    window = Window(folder)
    generate = window.screens["generate"]
    generate.choref.setChecked(True)
    generate.year.setValue(5787)
    generate.refresh()
    generate.generate()

    screen = window.sheet_screen
    sheet = screen.sheet
    R.equal("the sheet opens on its pages", 3, screen.pages_layout.count())

    preview = screen.pages_layout.itemAt(0).widget()
    R.equal("every cell on the page can be clicked", 80, len(preview.cells))

    # --- a click lands on the cell that is really under it -------------------------------
    # The screen's own slot opens a modal dialog and waits for a person, so it is taken off
    # first: this is checking that a click finds the right cell, not what happens next.
    rect, serial, key = preview.cells[7]
    preview.clicked.disconnect()
    landed = []
    preview.clicked.connect(lambda s, k: landed.append((s, k)))
    preview.mousePressEvent(type("Event", (), {"position": lambda self=None, r=rect: r.center()})())
    R.equal("a click in a cell reports that cell", [(serial, key)], landed)

    preview.mousePressEvent(type("Event", (), {"position": lambda self=None: QPointF(5, 5)})())
    R.equal("a click on the margin reports nothing", 1, len(landed))

    # --- typing over it -------------------------------------------------------------------
    settings = window.settings
    computed = sheetlib.computed_cell(sheet, window.state, settings, serial, key)
    R.expect("the cell works out to something", bool(computed), repr(computed)[:30])

    dialog = CellDialog(screen, title="test", computed=computed, current=None)
    R.equal("the dialog opens on what the cell works out to", engine_text_to_html(computed), dialog.field.value())
    R.equal("and offers no override until one is typed", None, dialog.value())

    dialog.field.set_value("<u>9:99</u> נסיון")
    R.equal("a typed value becomes the override", "<u>9:99</u> נסיון", dialog.value())

    screen.apply_edit(serial, key, None, dialog.value())
    R.equal("it is stored on the sheet", "<u>9:99</u> נסיון", sheetlib.get_override(sheet, serial, key))
    R.equal("and saved to disk", "<u>9:99</u> נסיון",
            statelib.load(folder / "zmanim-state.json")["sheets"][0]["overrides"][str(serial)][key])

    page = sheetlib.chart_pages(sheet, window.state, settings)[0]
    R.equal("the page carries it", "<u>9:99</u> נסיון", page.rows[serial][key])
    R.expect("and flags the cell as typed", key in page.authored.get(serial, set()), "")

    _image, cells = chart_preview(page, sheetlib.style_of(sheet), sheetlib.chrome_of(window.state["settings"]))
    R.equal("the redrawn page still maps every cell", 80, len(cells))

    pdf = write_chart_pdf(str(folder / "edited.pdf"), sheetlib.chart_pages(sheet, window.state, settings),
                          sheetlib.style_of(sheet), sheetlib.chrome_of(window.state["settings"]))
    R.expect("and it reaches the paper", "נסיון" in fitz.open(pdf)[0].get_text(), "")

    # --- undo and redo ----------------------------------------------------------------------
    screen.undo()
    R.equal("undo takes it away", None, sheetlib.get_override(sheet, serial, key))
    R.expect("and the cell works out again", computed,
             sheetlib.chart_pages(sheet, window.state, settings)[0].rows[serial][key])
    screen.redo()
    R.equal("redo puts it back", "<u>9:99</u> נסיון", sheetlib.get_override(sheet, serial, key))

    # Typed back to exactly what it works out to, it is not an override at all: stored as one
    # it would do nothing today and stop following a corrected formula tomorrow.
    same = CellDialog(screen, title="test", computed=computed, current=sheetlib.get_override(sheet, serial, key))
    same.field.set_value(engine_text_to_html(computed))
    R.equal("typing the worked out value back is not an override", None, same.value())

    reset = CellDialog(screen, title="test", computed=computed, current="<u>9:99</u>")
    reset.reset()
    R.equal("and the reset button clears it", None, reset.value())

    screen.apply_edit(serial, key, sheetlib.get_override(sheet, serial, key), None)
    R.equal("clearing removes the whole entry", {}, sheet.get("overrides"))

    # --- the page picker ---------------------------------------------------------------------
    # A sheet is three pages and a reprint is usually one of them, because one page was wrong
    # or one page ran out on the wall. Leaving a page out of the print does not take it off
    # the screen: it is still there to read.
    pages = screen.pages()
    R.equal("there is a tick box for every page", 3, len(screen.page_boxes))
    R.expect("all ticked to start with", all(box.isChecked() for box in screen.page_boxes), "")
    R.equal("so every page prints", 3, len(screen.chosen_pages()))

    screen.page_boxes[1].setChecked(False)
    chosen = screen.chosen_pages()
    R.equal("unticking one leaves two", 2, len(chosen))
    R.equal("and the one left out is the one unticked",
            [pages[0].weeks[0].parsha, pages[2].weeks[0].parsha],
            [p.weeks[0].parsha for p in chosen])

    # Measured on the paper rather than in the list: a page left out has to be missing from
    # the file, not merely from a count.
    picked = write_chart_pdf(str(folder / "picked.pdf"), chosen,
                             sheetlib.style_of(sheet), sheetlib.chrome_of(window.state["settings"]))
    doc = fitz.open(picked)
    R.equal("the file really has two pages", 2, doc.page_count)
    printed = "\n".join(p.get_text() for p in doc)
    R.expect("with nothing from the page left out", pages[1].weeks[0].parsha not in printed,
             pages[1].weeks[0].parsha)
    R.expect("and the pages kept still on it", pages[2].weeks[0].parsha in printed,
             pages[2].weeks[0].parsha)

    # Every edit redraws, which rebuilds the row. If the ticks did not survive that, a page
    # left out would quietly come back the moment a cell was typed over.
    screen.redraw()
    R.equal("a redraw keeps the ticks", [True, False, True], [box.isChecked() for box in screen.page_boxes])
    screen.page_boxes[1].setChecked(True)

    # --- the style controls ------------------------------------------------------------------
    screen.set_style("fontSizePt", 12.5)
    screen.set_style("accentColor", "#b0c4de")
    R.equal("the sheet keeps its own style", 12.5, sheet["style"]["fontSizePt"])
    R.equal("and the colour", "#b0c4de", sheet["style"]["accentColor"])
    R.equal("the last style set becomes the next sheet's starting point", 12.5,
            window.state["settings"]["sheetStyle"]["fontSizePt"])

    saved = statelib.load(folder / "zmanim-state.json")
    R.equal("style is saved too", "#b0c4de", saved["sheets"][0]["style"]["accentColor"])

    # A bigger type size means fewer rows fit in the same space, so the page has to stay
    # exactly a page: this is the invariant the whole layout hangs on.
    pdf = write_chart_pdf(str(folder / "styled.pdf"), sheetlib.chart_pages(sheet, window.state, settings),
                          sheetlib.style_of(sheet), sheetlib.chrome_of(window.state["settings"]))
    sizes = [(round(p.rect.width), round(p.rect.height)) for p in fitz.open(pdf)]
    R.equal("and a restyled page is still letter landscape", [(792, 612)] * 3, sizes)

sys.exit(0 if R.summary() else 1)
