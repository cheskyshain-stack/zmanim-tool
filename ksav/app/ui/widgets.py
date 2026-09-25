"""Small reusable pieces of the interface.

Kept here rather than repeated in each screen so that a card on the home screen
and a card in Settings have the same padding, the same corner radius and the
same hover behaviour. That consistency is most of what makes a Qt application
look designed rather than assembled.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Iterable, Sequence

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QDragEnterEvent, QDropEvent
from PySide6.QtWidgets import (
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)


class StatusPill(QLabel):
    """The offline indicator.

    Three states, and the wording is deliberate. "Processing locally" is a claim
    about what is happening now; "Model needed" says what is missing rather than
    just going amber. Never says "online".
    """

    OK, WARN, DANGER = "ok", "warn", "danger"

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("StatusPill")
        self.set_state(self.OK, "OFFLINE · Processing locally")

    def set_state(self, state: str, text: str, tooltip: str = "") -> None:
        self.setProperty("state", state)
        self.setText(text)
        self.setToolTip(tooltip or text)
        # Qt does not restyle on a property change unless it is asked to.
        self.style().unpolish(self)
        self.style().polish(self)


class Divider(QFrame):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("Divider")
        self.setFixedHeight(1)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)


class Card(QFrame):
    """A panel. Content goes into ``self.body``, which is a vertical layout."""

    def __init__(self, title: str = "", parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("Card")
        outer = QVBoxLayout(self)
        outer.setContentsMargins(18, 16, 18, 16)
        outer.setSpacing(10)
        if title:
            label = QLabel(title.upper())
            label.setObjectName("SectionLabel")
            outer.addWidget(label)
        self.body = QVBoxLayout()
        self.body.setContentsMargins(0, 0, 0, 0)
        self.body.setSpacing(10)
        outer.addLayout(self.body)

    def add(self, widget: QWidget) -> QWidget:
        self.body.addWidget(widget)
        return widget

    def add_row(self, label: str, widget: QWidget, hint: str = "") -> QWidget:
        """A labelled setting row: name on the left, control on the right."""
        row = QWidget()
        layout = QHBoxLayout(row)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(14)

        left = QVBoxLayout()
        left.setSpacing(1)
        name = QLabel(label)
        left.addWidget(name)
        if hint:
            caption = QLabel(hint)
            caption.setObjectName("Caption")
            caption.setWordWrap(True)
            left.addWidget(caption)
        holder = QWidget()
        holder.setLayout(left)
        holder.setMinimumWidth(230)

        layout.addWidget(holder, 1)
        layout.addWidget(widget, 0, Qt.AlignRight | Qt.AlignTop)
        self.body.addWidget(row)
        return widget


class ActionCard(QFrame):
    """One of the three large actions on the home screen."""

    clicked = Signal()

    def __init__(self, glyph: str, title: str, blurb: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("ActionCard")
        self.setCursor(Qt.PointingHandCursor)
        self.setMinimumHeight(168)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(22, 22, 22, 22)
        layout.setSpacing(8)

        icon = QLabel(glyph)
        icon.setObjectName("ActionGlyph")
        name = QLabel(title)
        name.setObjectName("ActionTitle")
        text = QLabel(blurb)
        text.setObjectName("ActionBlurb")
        text.setWordWrap(True)

        layout.addWidget(icon)
        layout.addWidget(name)
        layout.addWidget(text)
        layout.addStretch(1)

    def mouseReleaseEvent(self, event) -> None:      # noqa: N802 (Qt naming)
        if event.button() == Qt.LeftButton and self.rect().contains(event.position().toPoint()):
            self.clicked.emit()
        super().mouseReleaseEvent(event)


class DropZone(QFrame):
    """Drag and drop target. Accepts only the extensions it was given.

    Rejecting the wrong file type at the drag stage, rather than after the drop,
    is the difference between a control that feels solid and one that feels
    unpredictable.
    """

    dropped = Signal(list)

    def __init__(
        self,
        prompt: str,
        extensions: Sequence[str],
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.setObjectName("DropZone")
        self.setAcceptDrops(True)
        self.setMinimumHeight(150)
        self._extensions = {e.lower().lstrip(".") for e in extensions}

        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(6)
        layout.setAlignment(Qt.AlignCenter)

        self._prompt = QLabel(prompt)
        self._prompt.setAlignment(Qt.AlignCenter)
        self._prompt.setWordWrap(True)

        formats = QLabel(", ".join(sorted(e.upper() for e in self._extensions)))
        formats.setObjectName("Caption")
        formats.setAlignment(Qt.AlignCenter)

        layout.addWidget(self._prompt)
        layout.addWidget(formats)

    def _paths_from(self, event) -> list[Path]:
        if not event.mimeData().hasUrls():
            return []
        out = []
        for url in event.mimeData().urls():
            if not url.isLocalFile():
                continue
            path = Path(url.toLocalFile())
            if path.is_dir() or path.suffix.lower().lstrip(".") in self._extensions:
                out.append(path)
        return out

    def _set_hot(self, hot: bool) -> None:
        self.setProperty("hot", "true" if hot else "false")
        self.style().unpolish(self)
        self.style().polish(self)

    def dragEnterEvent(self, event: QDragEnterEvent) -> None:   # noqa: N802
        if self._paths_from(event):
            self._set_hot(True)
            event.acceptProposedAction()
        else:
            event.ignore()

    def dragLeaveEvent(self, event) -> None:                     # noqa: N802
        self._set_hot(False)

    def dropEvent(self, event: QDropEvent) -> None:              # noqa: N802
        self._set_hot(False)
        paths = self._paths_from(event)
        if paths:
            self.dropped.emit(paths)
            event.acceptProposedAction()


class KeyValueGrid(QWidget):
    """A two column list of facts. Used for the hardware readout and licences."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._grid = QGridLayout(self)
        self._grid.setContentsMargins(0, 0, 0, 0)
        self._grid.setHorizontalSpacing(20)
        self._grid.setVerticalSpacing(7)
        self._grid.setColumnStretch(1, 1)
        self._rows = 0

    def add(self, key: str, value: str, mono: bool = False) -> None:
        name = QLabel(key)
        name.setObjectName("Caption")
        name.setAlignment(Qt.AlignLeft | Qt.AlignTop)
        val = QLabel(value)
        val.setWordWrap(True)
        if mono:
            val.setObjectName("Mono")
        val.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self._grid.addWidget(name, self._rows, 0)
        self._grid.addWidget(val, self._rows, 1)
        self._rows += 1

    def clear(self) -> None:
        while self._grid.count():
            item = self._grid.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()
        self._rows = 0


def button(text: str, on_click: Callable[[], None] | None = None, primary: bool = False) -> QPushButton:
    btn = QPushButton(text)
    if primary:
        btn.setObjectName("Primary")
    btn.setCursor(Qt.PointingHandCursor)
    if on_click:
        btn.clicked.connect(lambda: on_click())
    return btn


def caption(text: str) -> QLabel:
    label = QLabel(text)
    label.setObjectName("Caption")
    label.setWordWrap(True)
    return label


def heading(text: str) -> QLabel:
    label = QLabel(text.upper())
    label.setObjectName("SectionLabel")
    return label
