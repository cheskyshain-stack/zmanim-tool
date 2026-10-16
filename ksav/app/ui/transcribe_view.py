"""Dropping recordings in and watching them go through.

The queue is polled rather than wired to Qt signals, because it runs on a plain
worker thread and marshalling signals across threads for something that changes
a few times a second buys nothing but a class of bug.
"""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtWidgets import (
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QProgressBar,
    QScrollArea,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from ..asr.audio.decode import SUPPORTED_EXTENSIONS, AudioError, is_supported, probe
from ..services.job_queue import Job, JobQueue, JobStatus
from .widgets import DropZone, button, caption

STATUS_WORDS = {
    JobStatus.QUEUED.value: "Waiting",
    JobStatus.RUNNING.value: "Working",
    JobStatus.DONE.value: "Finished",
    JobStatus.FAILED.value: "Did not finish",
    JobStatus.CANCELLED.value: "Cancelled",
    JobStatus.INTERRUPTED.value: "Will resume",
}


class JobRow(QFrame):
    open_requested = Signal(str)
    cancel_requested = Signal(str)
    remove_requested = Signal(str)

    def __init__(self, job: Job, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.job_id = job.id
        self.setObjectName("Card")
        self.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Fixed)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 12, 16, 12)
        layout.setSpacing(7)

        top = QHBoxLayout()
        top.setSpacing(12)
        self.name = QLabel(job.name)
        self.name.setStyleSheet("font-weight: 600;")
        top.addWidget(self.name, 1)
        self.status = QLabel("")
        self.status.setObjectName("Caption")
        top.addWidget(self.status, 0, Qt.AlignRight)
        layout.addLayout(top)

        self.bar = QProgressBar()
        self.bar.setRange(0, 100)
        self.bar.setTextVisible(False)
        layout.addWidget(self.bar)

        bottom = QHBoxLayout()
        bottom.setSpacing(8)
        self.detail = caption("")
        bottom.addWidget(self.detail, 1)
        self.open_button = button("Open", lambda: self.open_requested.emit(self.job_id))
        self.cancel_button = button("Cancel", lambda: self.cancel_requested.emit(self.job_id))
        self.remove_button = button("Remove", lambda: self.remove_requested.emit(self.job_id))
        for widget in (self.open_button, self.cancel_button, self.remove_button):
            bottom.addWidget(widget, 0, Qt.AlignRight)
        layout.addLayout(bottom)

        self.update_from(job)

    def update_from(self, job: Job) -> None:
        self.status.setText(STATUS_WORDS.get(job.status, job.status))
        self.bar.setValue(int(job.progress * 100))
        self.bar.setVisible(job.status in (JobStatus.RUNNING.value,
                                           JobStatus.INTERRUPTED.value))

        detail = job.message
        eta = job.eta_label()
        if eta:
            detail = f"{detail}  ·  {eta}"
        if job.status == JobStatus.FAILED.value and job.error:
            detail = job.error
        self.detail.setText(detail)

        finished = job.status == JobStatus.DONE.value
        self.open_button.setVisible(finished and bool(job.result_path))
        self.cancel_button.setVisible(job.is_active)
        self.remove_button.setVisible(not job.is_active)


class TranscribeView(QWidget):
    open_transcript = Signal(str)

    def __init__(self, queue: JobQueue, settings, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._queue = queue
        self._settings = settings
        self._rows: dict[str, JobRow] = {}

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(14)

        title = QLabel("Transcribe Recording")
        title.setObjectName("PageTitle")
        blurb = QLabel(
            "Drop in a shiur, a meeting or a voice note. Everything is transcribed on "
            "this computer and nothing is uploaded."
        )
        blurb.setObjectName("PageBlurb")
        blurb.setWordWrap(True)
        layout.addWidget(title)
        layout.addWidget(blurb)

        self.drop = DropZone(
            "Drop recordings here, or choose files",
            SUPPORTED_EXTENSIONS,
        )
        self.drop.dropped.connect(self.add_paths)
        layout.addWidget(self.drop)

        controls = QHBoxLayout()
        controls.setSpacing(8)
        controls.addWidget(button("Choose files", self._pick, primary=True))
        controls.addStretch(1)
        self.clear_button = button("Clear finished", self._clear)
        controls.addWidget(self.clear_button)
        layout.addLayout(controls)

        self.queue_label = QLabel("QUEUE")
        self.queue_label.setObjectName("SectionLabel")
        layout.addWidget(self.queue_label)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.NoFrame)
        holder = QWidget()
        self._queue_layout = QVBoxLayout(holder)
        self._queue_layout.setContentsMargins(0, 0, 8, 0)
        self._queue_layout.setSpacing(10)
        self.empty = caption("Nothing in the queue yet.")
        self._queue_layout.addWidget(self.empty)
        self._queue_layout.addStretch(1)
        scroll.setWidget(holder)
        layout.addWidget(scroll, 1)

        self._timer = QTimer(self)
        self._timer.setInterval(400)
        self._timer.timeout.connect(self.refresh)
        self._timer.start()
        self.refresh()

    # -- adding work -----------------------------------------------------

    def _pick(self) -> None:
        patterns = " ".join(f"*.{e}" for e in SUPPORTED_EXTENSIONS)
        paths, _ = QFileDialog.getOpenFileNames(
            self, "Choose recordings", self._settings.export.default_folder or "",
            f"Audio and video ({patterns});;All files (*)",
        )
        if paths:
            self.add_paths([Path(p) for p in paths])

    def add_paths(self, paths: list[Path]) -> int:
        """Queue whatever was dropped. A folder contributes its recordings."""
        files: list[Path] = []
        for path in paths:
            path = Path(path)
            if path.is_dir():
                files.extend(sorted(p for p in path.rglob("*") if p.is_file() and is_supported(p)))
            elif is_supported(path):
                files.append(path)

        if not files:
            QMessageBox.information(
                self, "Nothing to transcribe",
                "None of those are recordings Ksav can read. It handles "
                + ", ".join(sorted(e.upper() for e in SUPPORTED_EXTENSIONS[:6])) + " and more.",
            )
            return 0

        unreadable: list[str] = []
        added = 0
        for path in files:
            try:
                probe(path)                # fail now, not an hour into the queue
            except AudioError as exc:
                unreadable.append(str(exc))
                continue
            self._queue.add(path)
            added += 1

        if unreadable:
            QMessageBox.warning(
                self, "Some files could not be read", "\n".join(unreadable[:6])
            )
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
        self.queue_label.setText(
            f"QUEUE  ·  {active} IN PROGRESS" if active else "QUEUE"
        )
        self.clear_button.setVisible(any(not j.is_active for j in jobs))

    def _open(self, job_id: str) -> None:
        job = self._queue.get(job_id)
        if job and job.result_path:
            self.open_transcript.emit(job.result_path)

    def _remove(self, job_id: str) -> None:
        self._queue.remove(job_id)
        self.refresh()
