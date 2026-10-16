"""Dropping pages in and watching them get read.

Deliberately the same shape as the transcribe screen. A user who has learned one
queue should not have to learn a second, so the drop zone, the job rows and the
progress all behave identically.
"""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtWidgets import (
    QComboBox,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from ..ocr.base import HINT_LABELS, ScriptHint
from ..services.job_queue import JobQueue
from ..services.ocr import SUPPORTED_EXTENSIONS, is_pdf, is_supported
from .transcribe_view import JobRow
from .widgets import DropZone, button, caption


class OcrView(QWidget):
    open_document = Signal(str)

    def __init__(self, queue: JobQueue, settings, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._queue = queue
        self._settings = settings
        self._rows: dict[str, JobRow] = {}

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(14)

        title = QLabel("Extract Text From Page")
        title.setObjectName("PageTitle")
        blurb = QLabel(
            "Photos, scans and PDFs, in Hebrew, Yiddish, Aramaic and English. "
            "Pages are read on this computer and nothing is uploaded."
        )
        blurb.setObjectName("PageBlurb")
        blurb.setWordWrap(True)
        layout.addWidget(title)
        layout.addWidget(blurb)

        self.drop = DropZone(
            "Drop images, PDFs or a folder of scans here",
            SUPPORTED_EXTENSIONS,
        )
        self.drop.dropped.connect(self.add_paths)
        layout.addWidget(self.drop)

        controls = QHBoxLayout()
        controls.setSpacing(8)
        controls.addWidget(QLabel("What is on the page"), 0, Qt.AlignVCenter)

        self.hint_box = QComboBox()
        for hint in ScriptHint:
            self.hint_box.addItem(HINT_LABELS[hint], hint.value)
        self.hint_box.setMinimumWidth(210)
        self.hint_box.currentIndexChanged.connect(self._hint_changed)
        controls.addWidget(self.hint_box)

        controls.addWidget(button("Choose files", self._pick_files, primary=True))
        controls.addWidget(button("Choose a folder", self._pick_folder))
        controls.addStretch(1)
        self.clear_button = button("Clear finished", self._clear)
        controls.addWidget(self.clear_button)
        layout.addLayout(controls)

        # The honest warning for the hard cases, shown before the work is done
        # rather than after an hour of correcting.
        self.hint_note = caption("")
        self.hint_note.setVisible(False)
        layout.addWidget(self.hint_note)

        self.queue_label = QLabel("PAGES")
        self.queue_label.setObjectName("SectionLabel")
        layout.addWidget(self.queue_label)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.NoFrame)
        holder = QWidget()
        self._queue_layout = QVBoxLayout(holder)
        self._queue_layout.setContentsMargins(0, 0, 8, 0)
        self._queue_layout.setSpacing(10)
        self.empty = caption("Nothing here yet.")
        self._queue_layout.addWidget(self.empty)
        self._queue_layout.addStretch(1)
        scroll.setWidget(holder)
        layout.addWidget(scroll, 1)

        self._timer = QTimer(self)
        self._timer.setInterval(400)
        self._timer.timeout.connect(self.refresh)
        self._timer.start()
        self._hint_changed()
        self.refresh()

    # -- options ---------------------------------------------------------

    @property
    def hint(self) -> ScriptHint:
        return ScriptHint(self.hint_box.currentData())

    def _hint_changed(self) -> None:
        from ..ocr.tesseract_engine import QUALITY_NOTES

        note = QUALITY_NOTES.get(self.hint, "")
        self.hint_note.setText(note)
        self.hint_note.setVisible(bool(note))

    # -- adding work -----------------------------------------------------

    def _pick_files(self) -> None:
        patterns = " ".join(f"*.{e}" for e in SUPPORTED_EXTENSIONS)
        paths, _ = QFileDialog.getOpenFileNames(
            self, "Choose pages", self._settings.export.default_folder or "",
            f"Pages ({patterns});;All files (*)",
        )
        if paths:
            self.add_paths([Path(p) for p in paths])

    def _pick_folder(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, "Choose a folder of scans")
        if folder:
            self.add_paths([Path(folder)])

    def add_paths(self, paths: list[Path]) -> int:
        """A folder becomes one document; each file becomes its own."""
        added = 0
        rejected: list[str] = []

        for path in paths:
            path = Path(path)
            if path.is_dir():
                pages = [p for p in path.rglob("*") if p.is_file() and is_supported(p)]
                if not pages:
                    rejected.append(f"{path.name} has no pages Ksav can read.")
                    continue
                self._queue.add(path, {"script_hint": self.hint.value}, kind="ocr")
                added += 1
            elif is_supported(path):
                self._queue.add(path, {"script_hint": self.hint.value}, kind="ocr")
                added += 1
            else:
                rejected.append(f"{path.name} is not an image or a PDF.")

        if rejected and not added:
            QMessageBox.information(
                self, "Nothing to read",
                "\n".join(rejected[:6]) + "\n\nKsav reads "
                + ", ".join(sorted(e.upper() for e in SUPPORTED_EXTENSIONS[:6])) + " and PDF.",
            )
        elif rejected:
            QMessageBox.warning(self, "Some files were skipped", "\n".join(rejected[:6]))

        self.refresh()
        return added

    def _clear(self) -> None:
        self._queue.clear_finished()
        self.refresh()

    # -- keeping up to date ----------------------------------------------

    def refresh(self) -> None:
        jobs = self._queue.jobs()
        self.empty.setVisible(not jobs)

        seen = set()
        for position, job in enumerate(jobs):
            seen.add(job.id)
            row = self._rows.get(job.id)
            if row is None:
                row = JobRow(job)
                row.open_requested.connect(self._open)
                row.cancel_requested.connect(self._queue.cancel)
                row.remove_requested.connect(self._remove)
                self._rows[job.id] = row
                self._queue_layout.insertWidget(position + 1, row)
            else:
                row.update_from(job)

        for job_id in list(self._rows):
            if job_id not in seen:
                self._rows.pop(job_id).deleteLater()

        active = self._queue.active_count
        self.queue_label.setText(f"PAGES  ·  {active} IN PROGRESS" if active else "PAGES")
        self.clear_button.setVisible(any(not j.is_active for j in jobs))

    def _open(self, job_id: str) -> None:
        job = self._queue.get(job_id)
        if job and job.result_path:
            self.open_document.emit(job.result_path)

    def _remove(self, job_id: str) -> None:
        self._queue.remove(job_id)
        self.refresh()
