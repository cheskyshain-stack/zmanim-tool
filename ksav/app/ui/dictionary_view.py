"""The Yeshivish dictionary: search, edit, import, export.

Built for a vocabulary that gets large. The table shows a page of results rather
than everything, search goes through the database index rather than a scan, and
the editor is a dialog so the list never has to redraw while someone types.
"""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QFormLayout,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPlainTextEdit,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from ..language.lexicon import CATEGORIES, Entry, Lexicon, Variant
from .widgets import button, caption

PAGE_SIZE = 200


class EntryDialog(QDialog):
    """Add or change one term."""

    def __init__(self, entry: Entry | None = None, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Edit term" if entry else "Add a term")
        self.setMinimumWidth(520)
        self._entry = entry

        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        form = QFormLayout()
        form.setSpacing(9)

        self.canonical = QLineEdit(entry.canonical if entry else "")
        self.canonical.setPlaceholderText("Gemara")
        form.addRow("Correct to", self.canonical)

        self.hebrew = QLineEdit((entry.hebrew or "") if entry else "")
        self.hebrew.setPlaceholderText("גמרא")
        form.addRow("Hebrew form", self.hebrew)

        self.category = QComboBox()
        self.category.addItems(CATEGORIES)
        if entry:
            index = self.category.findText(entry.category)
            if index >= 0:
                self.category.setCurrentIndex(index)
        form.addRow("Category", self.category)

        self.variants = QPlainTextEdit(
            "\n".join(v.text for v in entry.variants) if entry else ""
        )
        self.variants.setPlaceholderText("camera\ngemorah\ngmara")
        self.variants.setFixedHeight(110)
        form.addRow("Heard as", self.variants)

        self.prefer_hebrew = QCheckBox("Prefer the Hebrew form in Automatic mixed")
        self.prefer_hebrew.setChecked(entry.prefer_hebrew if entry else False)
        form.addRow("", self.prefer_hebrew)

        self.notes = QLineEdit(entry.notes if entry else "")
        form.addRow("Notes", self.notes)
        layout.addLayout(form)

        layout.addWidget(caption(
            "One spelling per line under Heard as. A spelling that is also an "
            "ordinary English word is marked risky automatically and will only be "
            "corrected when the surrounding words are about learning."
        ))

        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self._accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _accept(self) -> None:
        if not self.canonical.text().strip():
            QMessageBox.warning(self, "A term needs a spelling",
                                "Fill in what the word should be corrected to.")
            return
        self.accept()

    def result_entry(self) -> Entry:
        existing = {v.text: v for v in (self._entry.variants if self._entry else [])}
        variants = []
        for line in self.variants.toPlainText().splitlines():
            text = line.strip()
            if not text:
                continue
            # Keep the context rules a term already had rather than resetting
            # them every time somebody opens the dialog.
            variants.append(existing.get(text) or Variant(text, kind="heard"))

        if self._entry:
            entry = self._entry
            entry.canonical = self.canonical.text().strip()
            entry.hebrew = self.hebrew.text().strip() or None
            entry.category = self.category.currentText()
            entry.prefer_hebrew = self.prefer_hebrew.isChecked()
            entry.notes = self.notes.text().strip()
            entry.variants = variants
            return entry

        return Entry(
            canonical=self.canonical.text().strip(),
            hebrew=self.hebrew.text().strip() or None,
            category=self.category.currentText(),
            prefer_hebrew=self.prefer_hebrew.isChecked(),
            notes=self.notes.text().strip(),
            variants=variants,
            source="user",
        )


class DictionaryView(QWidget):
    changed = Signal()

    def __init__(self, lexicon: Lexicon, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._lexicon = lexicon
        self._entries: list[Entry] = []

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(14)

        title = QLabel("Dictionary")
        title.setObjectName("PageTitle")
        blurb = QLabel(
            "Terms here do two jobs: they help the recogniser before it decides on a "
            "word, and they correct the result afterwards."
        )
        blurb.setObjectName("PageBlurb")
        blurb.setWordWrap(True)
        layout.addWidget(title)
        layout.addWidget(blurb)

        controls = QHBoxLayout()
        controls.setSpacing(8)
        self.search = QLineEdit()
        self.search.setPlaceholderText("Search terms, Hebrew, or a spelling")
        self.search.setClearButtonEnabled(True)
        controls.addWidget(self.search, 1)
        controls.addWidget(button("Add term", self._add, primary=True))
        controls.addWidget(button("Import", self._import))
        controls.addWidget(button("Export", self._export))
        layout.addLayout(controls)

        # Searching on every keystroke against a large dictionary is wasted work.
        self._debounce = QTimer(self)
        self._debounce.setSingleShot(True)
        self._debounce.setInterval(180)
        self._debounce.timeout.connect(self.refresh)
        self.search.textChanged.connect(lambda _t: self._debounce.start())

        self.summary = caption("")
        layout.addWidget(self.summary)

        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(
            ["Correct to", "Hebrew", "Category", "Heard as", ""]
        )
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setAlternatingRowColors(False)
        self.table.doubleClicked.connect(lambda _i: self._edit())
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(2, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(3, QHeaderView.Stretch)
        header.setSectionResizeMode(4, QHeaderView.ResizeToContents)
        layout.addWidget(self.table, 1)

        footer = QHBoxLayout()
        footer.setSpacing(8)
        footer.addStretch(1)
        footer.addWidget(button("Edit", self._edit))
        delete = button("Delete", self._delete)
        delete.setObjectName("Danger")
        footer.addWidget(delete)
        layout.addLayout(footer)

        self.refresh()

    # -- listing ---------------------------------------------------------

    def refresh(self) -> None:
        query = self.search.text().strip()
        self._entries = (
            self._lexicon.search(query, limit=PAGE_SIZE) if query
            else self._lexicon.all(limit=PAGE_SIZE)
        )

        self.table.setRowCount(len(self._entries))
        for row, entry in enumerate(self._entries):
            self.table.setItem(row, 0, QTableWidgetItem(entry.canonical))
            hebrew = QTableWidgetItem(entry.hebrew or "")
            hebrew.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
            self.table.setItem(row, 1, hebrew)
            self.table.setItem(row, 2, QTableWidgetItem(entry.category))
            self.table.setItem(row, 3, QTableWidgetItem(
                ", ".join(v.text for v in entry.variants)))
            risky = sum(1 for v in entry.variants if v.risk == "risky")
            self.table.setItem(row, 4, QTableWidgetItem("needs context" if risky else ""))

        total = self._lexicon.count()
        variants = self._lexicon.variant_count()
        if query:
            self.summary.setText(
                f"{len(self._entries)} of {total} terms match '{query}'."
                + ("  Showing the first 200." if len(self._entries) >= PAGE_SIZE else "")
            )
        else:
            self.summary.setText(
                f"{total} terms, {variants} spellings."
                + ("  Showing the first 200. Search to narrow it down."
                   if total > PAGE_SIZE else "")
            )

    def _selected(self) -> Entry | None:
        row = self.table.currentRow()
        if 0 <= row < len(self._entries):
            return self._entries[row]
        return None

    # -- editing ---------------------------------------------------------

    def _add(self) -> None:
        dialog = EntryDialog(parent=self)
        if dialog.exec() == QDialog.Accepted:
            self._lexicon.add(dialog.result_entry())
            self.refresh()
            self.changed.emit()

    def _edit(self) -> None:
        entry = self._selected()
        if entry is None:
            QMessageBox.information(self, "Choose a term", "Select a row to edit.")
            return
        dialog = EntryDialog(entry, parent=self)
        if dialog.exec() == QDialog.Accepted:
            self._lexicon.update(dialog.result_entry())
            self.refresh()
            self.changed.emit()

    def _delete(self) -> None:
        entry = self._selected()
        if entry is None:
            return
        answer = QMessageBox.question(
            self, "Delete this term?",
            f"Remove {entry.canonical} and its {len(entry.variants)} spellings?",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No,
        )
        if answer == QMessageBox.Yes:
            self._lexicon.delete(entry.id)
            self.refresh()
            self.changed.emit()

    # -- import and export -----------------------------------------------

    def _import(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Import a vocabulary list", "",
            "Vocabulary (*.csv *.tsv *.json *.jsonl);;All files (*)",
        )
        if not path:
            return
        try:
            added, merged = self._lexicon.import_file(Path(path))
        except Exception as exc:
            QMessageBox.warning(self, "Could not import that file", str(exc))
            return
        self.refresh()
        self.changed.emit()
        QMessageBox.information(
            self, "Imported",
            f"{added} new terms added, {merged} merged into terms you already had.\n\n"
            "Importing the same list twice is safe: matching terms are merged rather "
            "than duplicated.",
        )

    def _export(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self, "Export the dictionary", "ksav-dictionary.jsonl",
            "JSON lines (*.jsonl);;Spreadsheet (*.csv)",
        )
        if not path:
            return
        try:
            count = self._lexicon.export_file(Path(path))
        except Exception as exc:
            QMessageBox.warning(self, "Could not export", str(exc))
            return
        QMessageBox.information(self, "Exported", f"{count} terms written to "
                                                  f"{Path(path).name}.")
