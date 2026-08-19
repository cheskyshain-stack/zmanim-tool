"""The program itself: a window with a sidebar, and the screens behind it.

Deliberately plain. This is a tool one person uses a few times a year to make a board and
once a week to print a card, so every screen says what it is for in a sentence and the
buttons are the words for what they do.
"""
import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QPixmap
from PySide6.QtPrintSupport import QPrintDialog, QPrinter
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QRadioButton,
    QScrollArea,
    QSpinBox,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from . import sheets as sheetlib
from . import state as statelib
from .engine import pagination as pag
from .engine import tables as tables_mod
from .engine.settings import SEASON_LABELS
from .engine.sheets.weeks import compute_season_weeks, default_season_and_year
from .render.card import CardPainter
from .render.chart import ChartPainter
from .render.output import page_image, paint_card_pair, paint_pages, pdf_painter, printer_painter
from .weeks import current_serial, shabbos_date_line, week_index

PREVIEW_DPI = 110

# What <bdi> does in the web version, in plain characters: a first-strong isolate around a
# Hebrew run so the text around it is not reordered against it. Without it "שבת חורף 5787"
# in a label came out with the year on the left, because the paragraph takes its direction
# from its first strong character and that is Hebrew. Measured, not guessed: the year sat at
# x=0 and the name after it.
FSI, PDI = "\u2068", "\u2069"


def isolate(text: str) -> str:
    return FSI + str(text) + PDI


def sheet_name(sheet) -> str:
    return f'{isolate(sheetlib.label_of(sheet))} {sheet["hebrewYear"]}'


def data_dir() -> Path:
    """Where the save file lives.

    Beside the program when it is running from a folder that can be written to, which is
    what makes a copy on a USB stick carry its own data; otherwise the usual per-user place.
    """
    from PySide6.QtCore import QStandardPaths

    if getattr(sys, "frozen", False):
        beside = Path(sys.executable).parent
        try:
            probe = beside / ".writable"
            probe.touch()
            probe.unlink()
            return beside
        except OSError:
            pass
    return Path(QStandardPaths.writableLocation(QStandardPaths.AppDataLocation) or ".") / "ZmanimBoard"


class Screen(QWidget):
    """A screen with a heading and a line saying what it is for."""

    def __init__(self, title: str, blurb: str):
        super().__init__()
        self.column = QVBoxLayout(self)
        self.column.setContentsMargins(28, 24, 28, 24)
        self.column.setSpacing(12)
        heading = QLabel(title)
        heading.setStyleSheet("font-size: 20px; font-weight: 700;")
        self.column.addWidget(heading)
        if blurb:
            hint = QLabel(blurb)
            hint.setWordWrap(True)
            hint.setStyleSheet("color: #6b7280;")
            self.column.addWidget(hint)


class GenerateScreen(Screen):
    def __init__(self, window):
        super().__init__("Generate a sheet", "Pick the season and the year, then choose how the weeks split across printed pages.")
        self.window = window

        seasons = QHBoxLayout()
        self.kayitz = QRadioButton("שבת קיץ    (Pesach to Sukkos)")
        self.choref = QRadioButton("שבת חורף    (Sukkos to Pesach)")
        seasons.addWidget(self.kayitz)
        seasons.addWidget(self.choref)
        seasons.addStretch(1)
        self.column.addLayout(seasons)

        year_row = QHBoxLayout()
        year_row.addWidget(QLabel("Hebrew year"))
        self.year = QSpinBox()
        self.year.setRange(5000, 6000)
        year_row.addWidget(self.year)
        year_row.addStretch(1)
        self.column.addLayout(year_row)

        self.found = QLabel()
        self.found.setWordWrap(True)
        self.column.addWidget(self.found)

        pages_row = QHBoxLayout()
        pages_row.addWidget(QLabel("Number of pages"))
        self.page_count = QSpinBox()
        self.page_count.setRange(1, 8)
        self.page_count.setValue(3)
        pages_row.addWidget(self.page_count)
        pages_row.addStretch(1)
        self.column.addLayout(pages_row)

        self.sizes_row = QHBoxLayout()
        self.column.addLayout(self.sizes_row)
        self.size_boxes = []

        self.include_weekday = QCheckBox("Also make the Weekday chart for these weeks")
        self.include_weekday.setChecked(True)
        self.column.addWidget(self.include_weekday)

        self.problem = QLabel()
        self.problem.setStyleSheet("color: #b3261e;")
        self.problem.setWordWrap(True)
        self.column.addWidget(self.problem)

        go = QPushButton("Generate")
        go.setDefault(True)
        go.clicked.connect(self.generate)
        row = QHBoxLayout()
        row.addWidget(go)
        row.addStretch(1)
        self.column.addLayout(row)
        self.column.addStretch(1)

        # The default is the *next* season after the one containing today: a schedule is
        # always prepared ahead of time, never for the season in progress.
        season, year = default_season_and_year(window.settings)
        (self.kayitz if season == "kayitz" else self.choref).setChecked(True)
        self.year.setValue(year)

        for widget in (self.kayitz, self.choref):
            widget.toggled.connect(self.refresh)
        self.year.valueChanged.connect(self.refresh)
        self.page_count.valueChanged.connect(self.refresh)
        self.refresh()

    def season(self) -> str:
        return "kayitz" if self.kayitz.isChecked() else "choref"

    def refresh(self):
        weeks = compute_season_weeks(self.season(), self.year.value(), self.window.settings, self.window.tables).weeks
        self.weeks = weeks
        if weeks:
            first, last = weeks[0].date.isoformat(), weeks[-1].date.isoformat()
            self.found.setText(f"{len(weeks)} weeks, {first} to {last}. First parsha {weeks[0].parsha}, last {weeks[-1].parsha}.")
        else:
            self.found.setText("No weeks in that season and year.")
        self._rebuild_sizes(len(weeks))

    def _rebuild_sizes(self, total: int):
        while self.sizes_row.count():
            item = self.sizes_row.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        self.size_boxes = []
        if not total:
            return
        defaults = pag.default_page_sizes(total, self.page_count.value())
        for index, size in enumerate(defaults, start=1):
            self.sizes_row.addWidget(QLabel(f"Page {index}"))
            box = QSpinBox()
            box.setRange(0, total)
            box.setValue(size)
            box.valueChanged.connect(self._check_sizes)
            self.sizes_row.addWidget(box)
            self.size_boxes.append(box)
        self.sizes_row.addStretch(1)
        self._check_sizes()

    def sizes(self):
        return [box.value() for box in self.size_boxes]

    def _check_sizes(self):
        self.problem.setText(pag.validate_page_sizes(len(self.weeks), self.sizes()) or "")

    def generate(self):
        try:
            made = sheetlib.generate(
                self.season(), self.year.value(), self.sizes(),
                self.window.settings, self.window.tables, self.window.state["settings"],
                include_weekday=self.include_weekday.isChecked(),
            )
        except ValueError as err:
            self.problem.setText(str(err))
            return
        self.window.state["sheets"].extend(made)
        self.window.persist()
        self.window.open_sheet(made[0])


class WeekScreen(Screen):
    """One week at a time, laid out to read rather than to print.

    It follows whichever שבת is next and moves on by itself once Shabbos is over, so the
    screen is right on a Sunday morning without anyone touching it.
    """

    def __init__(self, window):
        super().__init__("This week", "The week's two pages, as they print. It follows whichever שבת is next and moves on once Shabbos is over.")
        self.window = window
        self.serial = None

        self.when = QLabel()
        self.when.setAlignment(Qt.AlignHCenter)
        self.when.setStyleSheet("font-weight: 600;")
        self.column.addWidget(self.when)

        nav = QHBoxLayout()
        nav.addStretch(1)
        self.previous = QPushButton("← Previous")
        self.previous.clicked.connect(lambda: self.step(-1))
        self.today = QPushButton("Today")
        self.today.clicked.connect(lambda: self.show_week(None))
        self.next = QPushButton("Next →")
        self.next.clicked.connect(lambda: self.step(1))
        for button in (self.previous, self.today, self.next):
            nav.addWidget(button)
        nav.addStretch(1)
        self.column.addLayout(nav)

        actions = QHBoxLayout()
        self.print_pair = QPushButton("Print both on one sheet")
        self.print_pair.clicked.connect(self.do_print_pair)
        self.print_rest = QPushButton("Print every week to the end of the season")
        self.print_rest.clicked.connect(self.do_print_rest)
        actions.addWidget(self.print_pair)
        actions.addWidget(self.print_rest)
        actions.addWidget(QLabel("Which page first"))
        self.order = QComboBox()
        self.order.addItem("שבת, then weekday", False)
        self.order.addItem("Weekday, then שבת", True)
        self.order.currentIndexChanged.connect(lambda _: self.show_week(self.serial))
        actions.addWidget(self.order)
        actions.addStretch(1)
        self.column.addLayout(actions)

        self.note = QLabel()
        self.note.setWordWrap(True)
        self.note.setStyleSheet("color: #6b7280;")
        self.column.addWidget(self.note)

        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.holder = QWidget()
        self.holder_layout = QVBoxLayout(self.holder)
        self.holder_layout.setAlignment(Qt.AlignHCenter | Qt.AlignTop)
        self.scroll.setWidget(self.holder)
        self.column.addWidget(self.scroll, 1)

    def serials(self):
        return list(week_index(self.window.state).keys())

    def refresh(self):
        self.show_week(self.serial)

    def step(self, direction: int):
        serials = self.serials()
        if self.serial in serials:
            at = serials.index(self.serial) + direction
            if 0 <= at < len(serials):
                self.show_week(serials[at])

    def show_week(self, serial):
        serials = self.serials()
        have = bool(serials)
        for widget in (self.previous, self.today, self.next, self.print_pair, self.print_rest, self.order):
            widget.setEnabled(have)
        while self.holder_layout.count():
            item = self.holder_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        if not have:
            self.when.setText("")
            self.note.setText("Generate a שבת sheet and its weeks show up here.")
            self.serial = None
            return

        self.serial = serial if serial in serials else current_serial(serials)
        english, hebrew = shabbos_date_line(self.serial, self.window.settings)
        self.when.setText(f"{english}\n{isolate(hebrew)}")
        at = serials.index(self.serial)
        self.previous.setEnabled(at > 0)
        self.next.setEnabled(at < len(serials) - 1)
        # At the end of the list, say why rather than only greying Next out.
        self.note.setText("" if at < len(serials) - 1 else "This is the last week you have generated.")

        for card in self.cards():
            label = QLabel()
            label.setPixmap(QPixmap.fromImage(page_image(
                lambda p, c=card: CardPainter(p, self.chrome()).paint(c), 8.5, 11.0, PREVIEW_DPI)))
            label.setFrameShape(QFrame.Box)
            self.holder_layout.addWidget(label)

    def chrome(self):
        return sheetlib.chrome_of(self.window.state["settings"])

    def cards(self, serial=None):
        return sheetlib.week_cards(serial or self.serial, self.window.state, self.window.settings,
                                   self.window.state["settings"], weekday_first=bool(self.order.currentData()))

    def do_print_pair(self):
        """Both cards on one landscape sheet."""
        cards = self.cards()
        if not cards:
            return
        printer = QPrinter(QPrinter.HighResolution)
        if QPrintDialog(printer, self).exec() != QPrintDialog.Accepted:
            return
        with printer_painter(printer, landscape=True) as (_device, painter):
            paint_card_pair(painter, cards, self.chrome())

    def do_print_rest(self):
        """Every week from this one to the end, portrait, one card a page."""
        serials = [s for s in self.serials() if s >= self.serial]
        cards = [card for serial in serials for card in self.cards(serial)]
        if not cards:
            return
        printer = QPrinter(QPrinter.HighResolution)
        dialog = QPrintDialog(printer, self)
        dialog.setWindowTitle(f"Print {len(cards)} pages, {len(serials)} weeks")
        if dialog.exec() != QPrintDialog.Accepted:
            return
        chrome = self.chrome()
        with printer_painter(printer, landscape=False) as (device, painter):
            paint_pages(device, painter, cards, lambda p, card: CardPainter(p, chrome).paint(card))


class SavedScreen(Screen):
    def __init__(self, window):
        super().__init__("Saved sheets", "Every sheet you have made. A שבת sheet and the Weekday chart made with it are one row: open either from it.")
        self.window = window
        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(["Sheet", "Weeks", "Pages", "Made", ""])
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.column.addWidget(self.table, 1)
        self.empty = QLabel("Nothing saved yet. Make one on the Generate screen.")
        self.empty.setStyleSheet("color: #6b7280;")
        self.column.addWidget(self.empty)

    def refresh(self):
        sheets = [s for s in self.window.state["sheets"] if s["season"] != "weekday"]
        sheets.sort(key=lambda s: str(s.get("createdAt") or ""), reverse=True)
        self.empty.setVisible(not sheets)
        self.table.setRowCount(len(sheets))
        for row, sheet in enumerate(sheets):
            weekday = sheetlib.companion_of(sheet, self.window.state["sheets"])
            self.table.setItem(row, 0, QTableWidgetItem(sheet_name(sheet)))
            self.table.setItem(row, 1, QTableWidgetItem(str(len(sheet["weeks"]))))
            self.table.setItem(row, 2, QTableWidgetItem(str(len(sheet["pageSizes"]))))
            self.table.setItem(row, 3, QTableWidgetItem(str(sheet.get("createdAt", ""))[:10]))
            actions = QWidget()
            layout = QHBoxLayout(actions)
            layout.setContentsMargins(0, 0, 0, 0)
            open_button = QPushButton("Open")
            open_button.clicked.connect(lambda _=False, s=sheet: self.window.open_sheet(s))
            layout.addWidget(open_button)
            if weekday:
                other = QPushButton("Open Weekday chart")
                other.clicked.connect(lambda _=False, s=weekday: self.window.open_sheet(s))
                layout.addWidget(other)
            delete = QPushButton("Delete")
            delete.clicked.connect(lambda _=False, s=sheet: self.delete(s))
            layout.addWidget(delete)
            layout.addStretch(1)
            self.table.setCellWidget(row, 4, actions)
        self.table.resizeColumnsToContents()

    def delete(self, sheet):
        weekday = sheetlib.companion_of(sheet, self.window.state["sheets"])
        pair = [sheet["id"]] + ([weekday["id"]] if weekday else [])
        name = sheet_name(sheet)
        asked = QMessageBox.question(self, "Delete this sheet?",
                                     f"Delete {name}{' and its Weekday chart' if weekday else ''}? This cannot be undone.")
        if asked != QMessageBox.Yes:
            return
        self.window.state["sheets"] = [s for s in self.window.state["sheets"] if s["id"] not in pair]
        self.window.persist()
        self.refresh()


class SheetScreen(QWidget):
    """One sheet, shown at the size it prints, with the buttons that put it on paper."""

    def __init__(self, window):
        super().__init__()
        self.window = window
        self.sheet = None
        column = QVBoxLayout(self)
        column.setContentsMargins(28, 24, 28, 24)
        column.setSpacing(12)

        bar = QHBoxLayout()
        back = QPushButton("← Back")
        back.clicked.connect(lambda: window.show_screen("saved"))
        bar.addWidget(back)
        self.title = QLabel()
        self.title.setStyleSheet("font-size: 18px; font-weight: 700;")
        bar.addWidget(self.title)
        bar.addStretch(1)
        self.companion = QPushButton()
        self.companion.clicked.connect(self.open_companion)
        bar.addWidget(self.companion)
        for label, slot in (("Print", self.print_sheet), ("Save as PDF", self.save_pdf)):
            button = QPushButton(label)
            button.clicked.connect(slot)
            bar.addWidget(button)
        column.addLayout(bar)

        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.pages_holder = QWidget()
        self.pages_layout = QVBoxLayout(self.pages_holder)
        self.pages_layout.setAlignment(Qt.AlignHCenter | Qt.AlignTop)
        self.scroll.setWidget(self.pages_holder)
        column.addWidget(self.scroll, 1)

    def show_sheet(self, sheet):
        self.sheet = sheet
        self.title.setText(sheet_name(sheet))
        other = sheetlib.companion_of(sheet, self.window.state["sheets"])
        self.companion.setVisible(bool(other))
        if other:
            self.companion.setText("Weekday chart →" if sheet["season"] != "weekday" else isolate("שבת") + " sheet →")
        while self.pages_layout.count():
            item = self.pages_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        for page in self.pages():
            label = QLabel()
            label.setPixmap(QPixmap.fromImage(self.render_preview(page)))
            label.setFrameShape(QFrame.Box)
            self.pages_layout.addWidget(label)

    def open_companion(self):
        other = sheetlib.companion_of(self.sheet, self.window.state["sheets"])
        if other:
            self.window.open_sheet(other)

    def pages(self):
        return sheetlib.chart_pages(
            self.sheet, self.window.state, self.window.settings,
            sheetlib.merged_shacharis_html(self.window.state["settings"]),
        )

    def _painter_parts(self):
        weekday = self.sheet["season"] == "weekday"
        return sheetlib.style_of(self.sheet), sheetlib.chrome_of(self.window.state["settings"], weekday)

    def render_preview(self, page):
        style, chrome = self._painter_parts()
        return page_image(lambda p: ChartPainter(p, style, chrome).paint(page), 11.0, 8.5, PREVIEW_DPI)

    def print_sheet(self):
        printer = QPrinter(QPrinter.HighResolution)
        dialog = QPrintDialog(printer, self)
        dialog.setWindowTitle("Print this chart")
        if dialog.exec() != QPrintDialog.Accepted:
            return
        style, chrome = self._painter_parts()
        with printer_painter(printer, landscape=True) as (device, painter):
            paint_pages(device, painter, self.pages(), lambda p, page: ChartPainter(p, style, chrome).paint(page))

    def save_pdf(self):
        # A file name is not display text: the isolate characters would end up in it.
        suggested = f'{sheetlib.label_of(self.sheet)} {self.sheet["hebrewYear"]}.pdf'
        path, _ = QFileDialog.getSaveFileName(self, "Save as PDF", suggested, "PDF (*.pdf)")
        if not path:
            return
        style, chrome = self._painter_parts()
        with pdf_painter(path, landscape=True) as (writer, painter):
            paint_pages(writer, painter, self.pages(), lambda p, page: ChartPainter(p, style, chrome).paint(page))
        QMessageBox.information(self, "Saved", f"Saved to {path}")


class Window(QMainWindow):
    def __init__(self, folder: Path):
        super().__init__()
        self.setWindowTitle("Zmanim boards")
        self.resize(1200, 860)
        self.paths = statelib.Paths.under(folder)
        self.state = statelib.load(self.paths.state)
        self.tables = tables_mod.load()

        shell = QWidget()
        layout = QHBoxLayout(shell)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self.nav = QListWidget()
        self.nav.setFixedWidth(190)
        self.nav.setStyleSheet(
            "QListWidget { background: #101c36; color: #a8b6cf; border: 0; font-size: 14px; }"
            "QListWidget::item { padding: 12px 16px; }"
            "QListWidget::item:selected { background: #1a2b4d; color: white; }"
        )
        layout.addWidget(self.nav)

        self.stack = QStackedWidget()
        layout.addWidget(self.stack, 1)
        self.setCentralWidget(shell)

        self.screens = {}
        for key, label, screen in (
            ("generate", "Generate", GenerateScreen(self)),
            ("week", "This week", WeekScreen(self)),
            ("saved", "Saved sheets", SavedScreen(self)),
        ):
            self.nav.addItem(QListWidgetItem(label))
            self.stack.addWidget(screen)
            self.screens[key] = screen
        self.sheet_screen = SheetScreen(self)
        self.stack.addWidget(self.sheet_screen)

        self.nav.currentRowChanged.connect(self._nav_changed)
        self.nav.setCurrentRow(0)

    @property
    def settings(self):
        return statelib.resolved_settings(self.state)

    NAV = ["generate", "week", "saved"]

    def _nav_changed(self, row: int):
        self.show_screen(self.NAV[row] if 0 <= row < len(self.NAV) else "generate")

    def show_screen(self, key: str):
        screen = self.screens[key]
        if hasattr(screen, "refresh"):
            screen.refresh()
        self.stack.setCurrentWidget(screen)
        row = self.NAV.index(key)
        if self.nav.currentRow() != row:
            self.nav.blockSignals(True)
            self.nav.setCurrentRow(row)
            self.nav.blockSignals(False)

    def open_sheet(self, sheet):
        self.sheet_screen.show_sheet(sheet)
        self.stack.setCurrentWidget(self.sheet_screen)

    def persist(self):
        statelib.save(self.paths.state, self.state)


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("ZmanimBoard")
    window = Window(data_dir())
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
