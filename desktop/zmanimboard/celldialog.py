"""Typing over one cell on a sheet.

A cell edit is a one-off: it belongs to this sheet and this week and nothing else. That is
the distinction against a rule, which is the shul's standing exception and reapplies every
year, and the dialog says so, because it is the thing people get wrong.
"""
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QDialog, QDialogButtonBox, QLabel, QPushButton, QVBoxLayout

from .htmlfield import HtmlField
from .render.richtext import engine_text_to_html


class CellDialog(QDialog):
    def __init__(self, parent, *, title: str, computed: str, current):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.setMinimumWidth(460)
        self.computed = computed
        self.cleared = False

        layout = QVBoxLayout(self)
        note = QLabel("This changes this one cell on this one sheet. For something that should happen "
                      "every year, make a rule in Settings instead.")
        note.setWordWrap(True)
        note.setStyleSheet("color: #6b7280;")
        layout.addWidget(note)

        layout.addWidget(QLabel("It works out to:"))
        shows = QLabel(engine_text_to_html(computed) or "(nothing)")
        shows.setTextFormat(Qt.RichText)  # so the underlines show as underlines
        shows.setStyleSheet("background: #f1f2f5; padding: 6px; border-radius: 4px;")
        shows.setWordWrap(True)
        layout.addWidget(shows)

        layout.addWidget(QLabel("Print instead:"))
        # An override is already markup; a computed value still carries the underline
        # sentinels, which have to become real markup before they can be edited.
        self.field = HtmlField(current if current is not None else engine_text_to_html(computed), height=110)
        layout.addWidget(self.field)
        hint = QLabel("Ctrl+U underlines the selection, which is how the board marks a time as the alternate one.")
        hint.setStyleSheet("color: #6b7280;")
        hint.setWordWrap(True)
        layout.addWidget(hint)

        reset = QPushButton("Put the worked out time back")
        reset.clicked.connect(self.reset)
        reset.setEnabled(current is not None)
        layout.addWidget(reset)

        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def reset(self):
        self.cleared = True
        self.accept()

    def value(self):
        """The override to store, or None for "no override".

        Typed back to exactly what the cell works out to, it is not an override at all.
        Stored as one it would do nothing today and quietly stop following a corrected
        formula tomorrow, which is the sort of thing nobody finds for a year.
        """
        if self.cleared:
            return None
        typed = self.field.value().strip()
        if not typed or typed == engine_text_to_html(self.computed).strip():
            return None
        return typed
