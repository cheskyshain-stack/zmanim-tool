"""Screens for features that arrive in a later phase.

These are deliberately not empty. An honest screen that says which phase brings
a feature, and exactly what will be in it, is more useful than a greyed out menu
item, and it keeps the navigation shape of the finished application in place
from the first build.
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QLabel, QVBoxLayout, QWidget

from .widgets import Card, caption


class ComingSoonView(QWidget):
    def __init__(
        self,
        title: str,
        blurb: str,
        phase: str,
        items: list[str],
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(18)

        heading = QLabel(title)
        heading.setObjectName("PageTitle")
        sub = QLabel(blurb)
        sub.setObjectName("PageBlurb")
        sub.setWordWrap(True)
        layout.addWidget(heading)
        layout.addWidget(sub)

        card = Card(f"Arriving in {phase}")
        for item in items:
            label = QLabel(f"•   {item}")
            label.setWordWrap(True)
            card.add(label)
        card.add(caption(
            "The interface, the settings and the engine plumbing for this screen are "
            "already in place. What is missing is the engine itself."
        ))
        layout.addWidget(card)
        layout.addStretch(1)


def transcribe_view() -> ComingSoonView:
    return ComingSoonView(
        "Transcribe Recording",
        "Offline transcription of MP3, WAV, M4A, MP4, AAC and FLAC, from a voice note "
        "to a multi hour shiur.",
        "Phase 1",
        [
            "Drag and drop, or pick files, with a queue that survives a restart",
            "Real progress and a finish time rather than a spinner",
            "Timestamps, paragraphs from pauses, and click a line to hear it",
            "Yeshivish correction with the four output modes",
            "Export to TXT, DOCX, SRT and VTT",
        ],
    )


def dictation_view() -> ComingSoonView:
    return ComingSoonView(
        "Live Dictation",
        "Speak and see the text appear, in Ksav or in whatever program you are typing into.",
        "Phase 3",
        [
            "Start and stop from the app, with a level meter and device choice",
            "A global shortcut you configure, in toggle or push to talk",
            "Types into Word, Outlook, a browser, WhatsApp Web and ordinary text boxes",
            "Text appears when you pause, roughly half a second to a second and a half "
            "after each phrase, not word by word",
        ],
    )


def ocr_view() -> ComingSoonView:
    return ComingSoonView(
        "Extract Text From Page",
        "Read text from photos, scans and PDFs in Hebrew, Yiddish, Aramaic and English.",
        "Phase 2",
        [
            "Single image, a folder of images, or a PDF with page navigation",
            "Deskew, denoise, contrast and orientation correction before reading",
            "Original page on the left, editable text on the right",
            "Right to left and left to right preserved per block, not per page",
            "Old seforim and Rashi script are honestly hard. See the notes in Settings",
        ],
    )


def dictionary_view() -> ComingSoonView:
    return ComingSoonView(
        "Dictionary",
        "The Yeshivish and Torah vocabulary that both improves recognition and corrects "
        "the result.",
        "Phase 1",
        [
            "Add, edit, delete and search, built to hold hundreds of thousands of terms",
            "Each term keeps its heard as spellings, its Hebrew form and its category",
            "Corrections respect word boundaries and context, never a global replace",
            "Risky terms that are also ordinary English words need context before they fire",
            "Import and export as CSV or JSON",
        ],
    )
