"""The home screen: three large actions, and the truth about the current state.

The brief asked for three primary actions and no clutter. What is here besides
them is a single readiness line, because the first question a user has on
opening an offline application is whether it can actually do anything yet.
"""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import QHBoxLayout, QLabel, QVBoxLayout, QWidget

from .widgets import ActionCard, Card, button, caption


class HomeView(QWidget):
    navigate = Signal(str)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(22)

        title = QLabel("What would you like to do?")
        title.setObjectName("PageTitle")
        blurb = QLabel(
            "Everything runs on this computer. Recordings, images and text never leave it."
        )
        blurb.setObjectName("PageBlurb")
        layout.addWidget(title)
        layout.addWidget(blurb)

        actions = QHBoxLayout()
        actions.setSpacing(16)
        cards = [
            ("\U0001F399", "Transcribe Recording",
             "Drop in a shiur, a meeting or a voice note and get a transcript you can edit.",
             "transcribe"),
            ("\U0001F3A4", "Start Dictation",
             "Speak and watch the text appear. Works into other programs with a shortcut.",
             "dictation"),
            ("\U0001F4C4", "Extract Text From Page",
             "Read a photo, a scan or a PDF, including Hebrew, Yiddish and mixed pages.",
             "ocr"),
        ]
        for glyph, name, text, target in cards:
            card = ActionCard(glyph, name, text)
            card.clicked.connect(lambda t=target: self.navigate.emit(t))
            actions.addWidget(card)
        layout.addLayout(actions)

        self.readiness = Card("Ready to work")
        self.readiness_text = QLabel("Checking what is installed...")
        self.readiness_text.setWordWrap(True)
        self.readiness.add(self.readiness_text)

        self.readiness_hint = caption("")
        self.readiness_hint.setVisible(False)
        self.readiness.add(self.readiness_hint)

        row = QHBoxLayout()
        row.addStretch(1)
        self.vault_button = button("Open Model Vault", lambda: self.navigate.emit("vault"))
        row.addWidget(self.vault_button)
        holder = QWidget()
        holder.setLayout(row)
        self.readiness.add(holder)

        layout.addWidget(self.readiness)
        layout.addStretch(1)

    def set_readiness(self, ready: bool, message: str, hint: str = "") -> None:
        self.readiness_text.setText(message)
        self.readiness_hint.setText(hint)
        self.readiness_hint.setVisible(bool(hint))
        self.vault_button.setText("Open Model Vault" if ready else "Install a model")
        self.vault_button.setObjectName("" if ready else "Primary")
        self.vault_button.style().unpolish(self.vault_button)
        self.vault_button.style().polish(self.vault_button)
