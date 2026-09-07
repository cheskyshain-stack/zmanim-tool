"""The Model Vault: what is on this computer, and the only screen that downloads.

Everything about this screen is written so that a user can answer one question
without help: can I unplug the network and still work. It shows what is
installed, what a task needs, exactly how large a download is before it starts,
and it offers an import from a folder for a machine that has never been online.
"""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, QThread, Signal
from PySide6.QtWidgets import (
    QApplication,
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

from ..core.logging import get
from ..platform.hardware import Hardware
from ..platform import media
from ..platform.models import CATALOGUE, ModelManager, ModelSpec, asr_models, ocr_models
from .widgets import Card, Divider, button, caption

log = get(__name__)


class _DownloadThread(QThread):
    progress = Signal(str, float, int, int)
    finished_ok = Signal(str)
    failed = Signal(str, str)

    def __init__(self, manager: ModelManager, spec: ModelSpec) -> None:
        super().__init__()
        self._manager = manager
        self._spec = spec
        self._cancel = False

    def cancel(self) -> None:
        self._cancel = True

    def run(self) -> None:
        try:
            self._manager.download(
                self._spec,
                on_progress=lambda name, frac, i, n: self.progress.emit(name, frac, i, n),
                should_cancel=lambda: self._cancel,
            )
        except InterruptedError:
            self.failed.emit(self._spec.id, "Download cancelled. Progress was kept.")
        except Exception as exc:                       # shown to the user verbatim
            log.exception("model download failed")
            self.failed.emit(self._spec.id, str(exc))
        else:
            self.finished_ok.emit(self._spec.id)


class ModelRow(QFrame):
    """One model in the vault."""

    changed = Signal()

    def __init__(self, spec: ModelSpec, manager: ModelManager, hardware: Hardware,
                 parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("Card")
        self.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Fixed)
        self._spec = spec
        self._manager = manager
        self._hardware = hardware
        self._thread: _DownloadThread | None = None
        # Where this model could be installed from without any network at all.
        self._found_at: Path | None = None

        outer = QVBoxLayout(self)
        outer.setContentsMargins(18, 15, 18, 15)
        outer.setSpacing(9)

        top = QHBoxLayout()
        top.setSpacing(12)

        left = QVBoxLayout()
        left.setSpacing(2)
        name = QLabel(spec.name)
        name.setStyleSheet("font-size: 15px; font-weight: 600;")
        left.addWidget(name)
        left.addWidget(caption(f"{spec.size_label}  ·  {spec.licence}  ·  {self._fit_note()}"))
        holder = QWidget()
        holder.setLayout(left)
        top.addWidget(holder, 1)

        self.status = QLabel("")
        self.status.setObjectName("Caption")
        top.addWidget(self.status, 0, Qt.AlignRight)
        outer.addLayout(top)

        notes = QLabel(spec.notes)
        notes.setObjectName("Caption")
        notes.setWordWrap(True)
        outer.addWidget(notes)

        self.bar = QProgressBar()
        self.bar.setRange(0, 100)
        self.bar.setTextVisible(False)
        self.bar.setVisible(False)
        outer.addWidget(self.bar)

        self.bar_label = caption("")
        self.bar_label.setVisible(False)
        outer.addWidget(self.bar_label)

        buttons = QHBoxLayout()
        buttons.setSpacing(8)
        buttons.addStretch(1)
        self.import_button = button("Choose a folder", self._import)
        self.action_button = button("Download", self._toggle, primary=True)
        self.remove_button = button("Remove", self._remove)
        self.remove_button.setObjectName("Danger")
        buttons.addWidget(self.import_button)
        buttons.addWidget(self.remove_button)
        buttons.addWidget(self.action_button)
        outer.addLayout(buttons)

        self.refresh()

    # -- helpers ---------------------------------------------------------

    def _fit_note(self) -> str:
        """A plain sentence about whether this machine can run it."""
        if self._spec.kind == "ocr":
            return "runs on any computer"
        vram = self._hardware.best_vram_gb
        if self._spec.min_vram_gb and vram >= self._spec.min_vram_gb:
            return "runs on your GPU"
        if self._spec.min_vram_gb and vram:
            return f"wants {self._spec.min_vram_gb:g} GB of VRAM, you have {vram:g}"
        if self._hardware.ram_gb and self._hardware.ram_gb < self._spec.min_ram_gb:
            return f"wants {self._spec.min_ram_gb:g} GB of RAM, you have {self._hardware.ram_gb:g}"
        if self._spec.min_vram_gb:
            return "will run on the processor, slowly"
        return "runs on the processor"

    def refresh(self) -> None:
        state = self._manager.state(self._spec)
        busy = self._thread is not None and self._thread.isRunning()
        self._found_at = None
        if not state.installed and not busy:
            found = self._manager.discover(self._spec)
            self._found_at = found[0] if found else None

        if busy:
            self.status.setText("Downloading")
            self.action_button.setText("Cancel")
            self.action_button.setObjectName("")
        elif state.installed:
            self.status.setText("Installed")
            self.action_button.setText("Installed")
            self.action_button.setEnabled(False)
            self.action_button.setObjectName("")
        elif self._found_at is not None:
            # Already on a stick or beside the program. No network needed, so
            # copying it across is the obvious action rather than downloading.
            self.status.setText(f"Ready to install from {media.describe(self._found_at)}")
            self.status.setToolTip(media.describe_full(self._found_at))
            self.action_button.setText("Install from USB")
            self.action_button.setEnabled(True)
            self.action_button.setObjectName("Primary")
        else:
            partial = state.bytes_on_disk > 0
            self.status.setText("Partly downloaded" if partial else "Not installed")
            self.action_button.setText("Resume download" if partial else "Download")
            self.action_button.setEnabled(True)
            self.action_button.setObjectName("Primary")

        self.remove_button.setVisible(state.installed or state.bytes_on_disk > 0)
        self.remove_button.setEnabled(not busy)
        self.import_button.setVisible(
            not state.installed and not busy and self._found_at is None
        )
        for widget in (self.action_button, self.remove_button):
            widget.style().unpolish(widget)
            widget.style().polish(widget)

    # -- actions ---------------------------------------------------------

    def _toggle(self) -> None:
        if self._thread and self._thread.isRunning():
            self._thread.cancel()
            self.bar_label.setText("Cancelling...")
            return

        if self._found_at is not None:
            self._install_from(self._found_at)
            return

        answer = QMessageBox.question(
            self,
            "Download this model?",
            f"{self._spec.name} is {self._spec.size_label}.\n\n"
            "This is the only time Ksav uses the internet. Once the download "
            "finishes you can disconnect and keep working.\n\nStart the download?",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.Yes,
        )
        if answer != QMessageBox.Yes:
            return

        self.bar.setVisible(True)
        self.bar_label.setVisible(True)
        self.bar.setValue(0)

        self._thread = _DownloadThread(self._manager, self._spec)
        self._thread.progress.connect(self._on_progress)
        self._thread.finished_ok.connect(self._on_done)
        self._thread.failed.connect(self._on_failed)
        self._thread.start()
        self.refresh()

    def _on_progress(self, name: str, fraction: float, index: int, total: int) -> None:
        overall = (index + fraction) / max(1, total)
        self.bar.setValue(int(overall * 100))
        self.bar_label.setText(f"{name}  ·  file {index + 1} of {total}")

    def _on_done(self, _model_id: str) -> None:
        self.bar.setVisible(False)
        self.bar_label.setVisible(False)
        self._thread = None
        self.refresh()
        self.changed.emit()

    def _on_failed(self, _model_id: str, message: str) -> None:
        self.bar.setVisible(False)
        self.bar_label.setVisible(False)
        self._thread = None
        self.refresh()
        self.changed.emit()
        QMessageBox.warning(self, "Download did not finish", message)

    def _import(self) -> None:
        folder = QFileDialog.getExistingDirectory(
            self, f"Choose the folder holding {self._spec.name}"
        )
        if folder:
            self._install_from(Path(folder))

    def _install_from(self, folder: Path) -> None:
        """Copy a model in from a stick or a folder. Never touches the network."""
        self.bar.setVisible(True)
        self.bar.setRange(0, 0)          # copying, with no useful percentage
        self.bar_label.setVisible(True)
        self.bar_label.setText(f"Copying from {media.describe(folder)}...")
        QApplication.processEvents()
        try:
            self._manager.import_from_folder(self._spec, folder)
        except Exception as exc:
            QMessageBox.warning(self, "Could not use that folder", str(exc))
        finally:
            self.bar.setRange(0, 100)
            self.bar.setVisible(False)
            self.bar_label.setVisible(False)
        self.refresh()
        self.changed.emit()

    def _remove(self) -> None:
        answer = QMessageBox.question(
            self,
            "Remove this model?",
            f"Delete {self._spec.name} from this computer and free {self._spec.size_label}?",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No,
        )
        if answer == QMessageBox.Yes:
            self._manager.remove(self._spec)
            self.refresh()
            self.changed.emit()


class ModelVaultView(QWidget):
    changed = Signal()

    def __init__(self, manager: ModelManager, hardware: Hardware,
                 parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._manager = manager
        self._rows: list[ModelRow] = []

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(16)

        title = QLabel("Model Vault")
        title.setObjectName("PageTitle")
        blurb = QLabel(
            "Models are installed once and then stay on this computer, either copied "
            "from a USB stick or downloaded. This screen is the only place in Ksav that "
            "can use the internet, and only when you press Download."
        )
        blurb.setObjectName("PageBlurb")
        blurb.setWordWrap(True)
        outer.addWidget(title)
        outer.addWidget(blurb)

        self.summary = caption("")
        outer.addWidget(self.summary)

        self.usb_banner = QFrame()
        self.usb_banner.setObjectName("Card")
        banner_layout = QHBoxLayout(self.usb_banner)
        banner_layout.setContentsMargins(16, 12, 16, 12)
        banner_layout.setSpacing(12)
        self.usb_text = QLabel("")
        self.usb_text.setWordWrap(True)
        banner_layout.addWidget(self.usb_text, 1)
        self.usb_button = button("Install them all", self._install_everything, primary=True)
        banner_layout.addWidget(self.usb_button, 0, Qt.AlignRight)
        self.usb_banner.setVisible(False)
        outer.addWidget(self.usb_banner)

        outer.addWidget(Divider())

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.NoFrame)
        inner = QWidget()
        layout = QVBoxLayout(inner)
        layout.setContentsMargins(0, 2, 10, 0)
        layout.setSpacing(12)

        for heading, specs in (("Speech models", asr_models()),
                               ("Page reading", ocr_models())):
            if not specs:
                continue
            label = QLabel(heading.upper())
            label.setObjectName("SectionLabel")
            layout.addSpacing(4)
            layout.addWidget(label)
            for spec in specs:
                row = ModelRow(spec, manager, hardware)
                row.changed.connect(self._on_changed)
                self._rows.append(row)
                layout.addWidget(row)

        layout.addStretch(1)
        scroll.setWidget(inner)
        outer.addWidget(scroll, 1)
        self.refresh()

    def _on_changed(self) -> None:
        self.refresh()
        self.changed.emit()

    def _install_everything(self) -> None:
        for model_id, folder in self._manager.discover_all().items():
            spec = next((s for s in CATALOGUE if s.id == model_id), None)
            if spec is None:
                continue
            try:
                self._manager.import_from_folder(spec, folder)
            except Exception as exc:
                QMessageBox.warning(self, "Could not use that folder", str(exc))
                break
        self._on_changed()

    def refresh(self) -> None:
        for row in self._rows:
            row.refresh()

        waiting = self._manager.discover_all()
        self.usb_banner.setVisible(bool(waiting))
        if waiting:
            where = media.describe(next(iter(waiting.values())))
            count = len(waiting)
            first = next(iter(waiting.values()))
            self.usb_text.setText(
                f"{count} model{'s' if count != 1 else ''} ready to install from "
                f"{where}. No internet is needed."
            )
            self.usb_text.setToolTip(media.describe_full(first))

        installed = self._manager.installed_ids()
        used = self._manager.total_bytes_on_disk() / (1024 ** 3)
        if installed:
            self.summary.setText(
                f"{len(installed)} model{'s' if len(installed) != 1 else ''} installed, "
                f"using {used:.1f} GB. You can work with the network unplugged."
            )
            self.summary.setVisible(True)
        elif waiting:
            # The banner below already says what to do. Repeating "no models
            # installed" here just contradicts it.
            self.summary.setVisible(False)
        else:
            self.summary.setText(
                "No models installed yet. Transcription needs one of these before it can run."
            )
            self.summary.setVisible(True)
