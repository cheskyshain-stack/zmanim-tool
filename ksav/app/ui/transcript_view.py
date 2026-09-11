"""Reading, correcting and exporting one transcript.

Three things here are worth knowing about.

**Mode switching is a re-render, not a re-transcription.** The four modes read
the same stored pair of transcript and corrections, so switching is instant and
Mode D really is the engine's own words.

**Clicking a paragraph seeks the recording.** The mapping is paragraph to time
rather than character offset to time, so it survives the user editing a sentence.
Adding or removing whole paragraphs does shift it, which is stated rather than
hidden.

**Every correction is listed with its reason and can be reversed one at a time.**
Suggestions the gating rules held back appear in the same list, greyed, with a
button to accept them.
"""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QTextCursor
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QScrollArea,
    QSplitter,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from ..core.models import (
    Correction,
    CorrectedTranscript,
    MODE_LABELS,
    OutputMode,
)
from ..export import docx as docx_export
from ..export import subtitles, txt as txt_export
from ..language import render
from .audio_bar import AudioBar
from .widgets import Card, Divider, button, caption

EXPORT_FILTERS = (
    "Text (*.txt);;Word document (*.docx);;Subtitles (*.srt);;Web subtitles (*.vtt)"
)


class CorrectionRow(QFrame):
    """One change, with the reason it was made and a way to reverse it."""

    toggled = Signal(object)

    def __init__(self, correction: Correction, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.correction = correction
        self.setObjectName("Card")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 9, 12, 9)
        layout.setSpacing(4)

        top = QHBoxLayout()
        top.setSpacing(8)
        change = QLabel(f"{correction.raw}  →  {correction.canonical}")
        change.setWordWrap(True)
        change.setStyleSheet("font-weight: 600;")
        top.addWidget(change, 1)

        self.action = button("Undo" if correction.applied else "Apply", self._toggle)
        self.action.setFixedWidth(72)
        top.addWidget(self.action, 0, Qt.AlignRight)
        layout.addLayout(top)

        reason = caption(correction.reason)
        layout.addWidget(reason)
        if not correction.applied:
            self.setStyleSheet("QFrame#Card { border-style: dashed; }")

    def _toggle(self) -> None:
        self.correction.applied = not self.correction.applied
        self.action.setText("Undo" if self.correction.applied else "Apply")
        self.setStyleSheet(
            "" if self.correction.applied else "QFrame#Card { border-style: dashed; }"
        )
        self.toggled.emit(self.correction)


class TranscriptView(QWidget):
    """One transcript, its corrections, and the recording behind it."""

    def __init__(self, settings, categories: dict[str, str] | None = None,
                 parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._settings = settings
        self._categories = categories or {}
        self._corrected: CorrectedTranscript | None = None
        self._paragraph_times: list[float] = []
        self._edited = False
        self._rendering = False

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(14)

        # -- header
        header = QHBoxLayout()
        header.setSpacing(12)
        titles = QVBoxLayout()
        titles.setSpacing(1)
        self.title = QLabel("Transcript")
        self.title.setObjectName("PageTitle")
        self.subtitle = QLabel("")
        self.subtitle.setObjectName("Caption")
        titles.addWidget(self.title)
        titles.addWidget(self.subtitle)
        holder = QWidget()
        holder.setLayout(titles)
        header.addWidget(holder, 1)

        self.mode_box = QComboBox()
        for mode in OutputMode:
            self.mode_box.addItem(MODE_LABELS[mode], mode.value)
        self.mode_box.setCurrentIndex(
            max(0, self.mode_box.findData(settings.language.output_mode))
        )
        self.mode_box.currentIndexChanged.connect(self._mode_changed)
        self.mode_box.setMinimumWidth(190)
        header.addWidget(QLabel("Show as"), 0, Qt.AlignVCenter)
        header.addWidget(self.mode_box, 0)
        layout.addLayout(header)

        # -- body: text on the left, corrections on the right
        splitter = QSplitter(Qt.Horizontal)

        left = QWidget()
        left_layout = QVBoxLayout(left)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.setSpacing(8)

        self.editor = QTextEdit()
        self.editor.setAcceptRichText(False)
        self.editor.textChanged.connect(self._on_edited)
        self.editor.cursorPositionChanged.connect(self._on_cursor)
        left_layout.addWidget(self.editor, 1)

        self.audio = AudioBar()
        left_layout.addWidget(self.audio)

        self.hint = caption(
            "Click a paragraph to jump the recording to it."
        )
        left_layout.addWidget(self.hint)
        splitter.addWidget(left)

        right = QWidget()
        right_layout = QVBoxLayout(right)
        right_layout.setContentsMargins(0, 0, 0, 0)
        right_layout.setSpacing(8)

        self.corrections_title = QLabel("CORRECTIONS")
        self.corrections_title.setObjectName("SectionLabel")
        right_layout.addWidget(self.corrections_title)
        self.corrections_summary = caption("")
        right_layout.addWidget(self.corrections_summary)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.NoFrame)
        self._corrections_holder = QWidget()
        self._corrections_layout = QVBoxLayout(self._corrections_holder)
        self._corrections_layout.setContentsMargins(0, 0, 8, 0)
        self._corrections_layout.setSpacing(8)
        self._corrections_layout.addStretch(1)
        scroll.setWidget(self._corrections_holder)
        right_layout.addWidget(scroll, 1)
        splitter.addWidget(right)

        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 2)
        splitter.setSizes([680, 380])
        layout.addWidget(splitter, 1)

        # -- footer
        footer = QHBoxLayout()
        footer.setSpacing(8)
        footer.addWidget(button("Copy all", self.copy_all))
        footer.addWidget(button("Copy selection", self.copy_selection))
        footer.addStretch(1)
        footer.addWidget(button("Export", self.export, primary=True))
        layout.addLayout(footer)

    # -- loading ---------------------------------------------------------

    def load(self, corrected: CorrectedTranscript, categories: dict[str, str] | None = None) -> None:
        self._corrected = corrected
        if categories is not None:
            self._categories = categories
        transcript = corrected.transcript

        name = Path(transcript.source_path).name or "Transcript"
        self.title.setText(name)
        parts = [render.timestamp(transcript.duration)]
        if transcript.model_id:
            parts.append(transcript.model_id)
        if transcript.language:
            parts.append(transcript.language)
        if not transcript.complete:
            parts.append("incomplete")
        self.subtitle.setText("  ·  ".join(parts))

        self.audio.load(transcript.source_path)
        self._rebuild_corrections()
        self._render()

    @property
    def mode(self) -> OutputMode:
        return OutputMode(self.mode_box.currentData())

    # -- rendering -------------------------------------------------------

    def _policy(self) -> render.RenderPolicy:
        return render.RenderPolicy.from_settings(self._settings)

    def _render(self) -> None:
        if self._corrected is None:
            return
        self._rendering = True
        paragraphs = render.render_paragraphs(
            self._corrected, self.mode, self._policy(), self._categories
        )
        self._paragraph_times = [start for start, _ in paragraphs]
        self.editor.setPlainText("\n\n".join(text for _, text in paragraphs))
        self._rendering = False
        self._edited = False

        # A paragraph in Qt is a text block; blank lines between them count too,
        # so the mapping is built from the blocks that carry text.
        self._block_times: dict[int, float] = {}
        block, index = self.editor.document().firstBlock(), 0
        while block.isValid():
            if block.text().strip() and index < len(self._paragraph_times):
                self._block_times[block.blockNumber()] = self._paragraph_times[index]
                index += 1
            block = block.next()

    def _mode_changed(self) -> None:
        if self._edited:
            answer = QMessageBox.question(
                self,
                "Discard your edits?",
                "Switching mode redraws the transcript from the recognised text, "
                "which will discard the changes you typed.\n\nSwitch anyway?",
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.No,
            )
            if answer != QMessageBox.Yes:
                self.mode_box.blockSignals(True)
                self.mode_box.setCurrentIndex(
                    max(0, self.mode_box.findData(self._settings.language.output_mode))
                )
                self.mode_box.blockSignals(False)
                return
        self._settings.language.output_mode = self.mode.value
        self._render()

    def _on_edited(self) -> None:
        if not self._rendering:
            self._edited = True

    def _on_cursor(self) -> None:
        """Clicking in the text moves the recording to that paragraph."""
        if not self._corrected or not getattr(self, "_block_times", None):
            return
        block = self.editor.textCursor().blockNumber()
        seconds = self._block_times.get(block)
        if seconds is None:
            return
        self.hint.setText(
            f"This paragraph starts at {render.timestamp(seconds)}. "
            f"Click Play to hear it."
        )
        self.audio.seek(seconds)

    # -- corrections -----------------------------------------------------

    def _rebuild_corrections(self) -> None:
        while self._corrections_layout.count() > 1:
            item = self._corrections_layout.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()

        if self._corrected is None:
            return

        # A term already written correctly is annotated so Mode B can act on it,
        # but it is not a correction and listing it would bury the real ones.
        changes = [
            c for c in self._corrected.corrections
            if c.raw.casefold() != c.canonical.casefold()
        ]
        changes.sort(key=lambda c: (not c.applied, c.segment_index, c.start))

        for correction in changes:
            row = CorrectionRow(correction)
            row.toggled.connect(lambda _c: self._render())
            self._corrections_layout.insertWidget(
                self._corrections_layout.count() - 1, row
            )

        applied = sum(1 for c in changes if c.applied)
        suggested = len(changes) - applied
        if not changes:
            self.corrections_summary.setText(
                "Nothing needed correcting, or nothing matched the dictionary."
            )
        else:
            text = f"{applied} applied"
            if suggested:
                text += f", {suggested} suggested and not applied"
            self.corrections_summary.setText(text + ". Every one can be reversed.")

    # -- clipboard and export --------------------------------------------

    def copy_all(self) -> None:
        QApplication.clipboard().setText(self.editor.toPlainText())

    def copy_selection(self) -> None:
        cursor = self.editor.textCursor()
        text = cursor.selectedText().replace(" ", "\n")
        QApplication.clipboard().setText(text or self.editor.toPlainText())

    def export(self) -> None:
        if self._corrected is None:
            return
        default = self._settings.export.default_folder or str(Path.home())
        stem = Path(self._corrected.transcript.source_path).stem or "transcript"
        path, chosen = QFileDialog.getSaveFileName(
            self, "Export transcript", str(Path(default) / f"{stem}.txt"), EXPORT_FILTERS
        )
        if not path:
            return
        try:
            self.export_to(Path(path))
        except Exception as exc:
            QMessageBox.warning(self, "Could not export", str(exc))
            return
        QMessageBox.information(
            self, "Exported", f"Saved to {Path(path).name}."
        )

    def export_to(self, path: Path) -> Path:
        """Write in whichever format the extension asks for."""
        if self._corrected is None:
            raise RuntimeError("There is no transcript to export.")
        suffix = path.suffix.lower()
        policy = self._policy()
        args = (self._corrected, path, self.mode, policy, self._categories)

        if suffix == ".docx":
            return docx_export.write(*args, title=Path(
                self._corrected.transcript.source_path).stem)
        if suffix == ".srt":
            return subtitles.write_srt(*args)
        if suffix == ".vtt":
            return subtitles.write_vtt(*args)
        return txt_export.write(*args)
