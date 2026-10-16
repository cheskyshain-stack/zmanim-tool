"""Speak, and watch the text appear.

The status line is doing real work here. Dictation has a delay that depends on
the model and the machine, and a user who does not know that thinks it is
broken. So the screen says which model is running, says "thinking" while it is,
and states plainly that text arrives when you pause.
"""

from __future__ import annotations

from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QProgressBar,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from ..asr.audio import capture
from ..platform.inject import Injector, spacing_before
from ..services.dictation import DictationService, Phrase, State
from .widgets import Card, Divider, button, caption

STATE_WORDS = {
    State.IDLE: "Not listening",
    State.LISTENING: "Listening",
    State.THINKING: "Working out what you said",
    State.STOPPING: "Finishing the last phrase",
}


class DictationView(QWidget):
    """The dictation screen.

    Recognition runs on a worker thread, and Qt widgets may only be touched from
    the thread that owns them. So the service's callbacks do nothing but emit
    these signals: because this object lives on the interface thread, Qt queues
    them across automatically and the slots run where they are allowed to.

    Calling the widgets directly from the worker was the first version, and Qt
    said so immediately: "Cannot create children for a parent that is in a
    different thread". On Windows that is a crash rather than a warning.
    """

    phrase_arrived = Signal(object)
    state_changed = Signal(str)
    error_raised = Signal(str)

    def __init__(self, service: DictationService, settings,
                 hotkeys=None, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._service = service
        self._settings = settings
        self._hotkeys = hotkeys
        self._injector = Injector(settings.dictation.injection_method)
        self._text = ""

        # The service calls these from its worker thread; the signals hop the
        # result onto the interface thread before anything touches a widget.
        service.on_phrase = self.phrase_arrived.emit
        service.on_state = self.state_changed.emit
        service.on_error = self.error_raised.emit
        self.phrase_arrived.connect(self._on_phrase)
        self.state_changed.connect(self._on_state)
        self.error_raised.connect(self._on_error)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(14)

        title = QLabel("Live Dictation")
        title.setObjectName("PageTitle")
        blurb = QLabel(
            "Speak and the text appears. Everything is recognised on this computer."
        )
        blurb.setObjectName("PageBlurb")
        layout.addWidget(title)
        layout.addWidget(blurb)

        # -- controls
        controls = QHBoxLayout()
        controls.setSpacing(12)
        self.toggle_button = button("Start dictation", self.toggle, primary=True)
        self.toggle_button.setMinimumWidth(170)
        controls.addWidget(self.toggle_button)

        self.meter = QProgressBar()
        self.meter.setRange(0, 100)
        self.meter.setTextVisible(False)
        self.meter.setFixedHeight(8)
        controls.addWidget(self.meter, 1)

        self.state_label = QLabel(STATE_WORDS[State.IDLE])
        self.state_label.setObjectName("Caption")
        self.state_label.setMinimumWidth(190)
        controls.addWidget(self.state_label, 0, Qt.AlignRight)
        layout.addLayout(controls)

        self.status = caption("")
        layout.addWidget(self.status)
        layout.addWidget(Divider())

        # -- the text
        self.editor = QTextEdit()
        self.editor.setAcceptRichText(False)
        self.editor.setPlaceholderText(
            "Dictated text appears here when you pause between phrases."
        )
        layout.addWidget(self.editor, 1)

        # -- options
        options = Card("While dictating")
        self.inject_check = QCheckBox("Type into whichever program has the cursor")
        self.inject_check.setChecked(settings.dictation.inject_into_focused_app)
        self.inject_check.stateChanged.connect(self._save_options)
        options.add(self.inject_check)
        self.inject_note = caption("")
        options.add(self.inject_note)

        self.correct_check = QCheckBox("Correct Torah terms as I speak")
        self.correct_check.setChecked(settings.dictation.apply_corrections)
        self.correct_check.stateChanged.connect(self._save_options)
        options.add(self.correct_check)

        device_row = QHBoxLayout()
        device_row.setSpacing(8)
        device_row.addWidget(QLabel("Microphone"), 0, Qt.AlignVCenter)
        self.device_box = QComboBox()
        self.device_box.setMinimumWidth(260)
        self.device_box.currentIndexChanged.connect(self._save_options)
        device_row.addWidget(self.device_box, 1)
        holder = QWidget()
        holder.setLayout(device_row)
        options.add(holder)

        self.hotkey_label = caption("")
        options.add(self.hotkey_label)
        layout.addWidget(options)

        # -- footer
        footer = QHBoxLayout()
        footer.setSpacing(8)
        footer.addWidget(button("Copy", self.copy))
        footer.addWidget(button("Clear", self.clear))
        footer.addStretch(1)
        layout.addLayout(footer)

        self._timer = QTimer(self)
        self._timer.setInterval(80)
        self._timer.timeout.connect(self._tick)

        self.refresh()

    # -- state -----------------------------------------------------------

    def refresh(self) -> None:
        """Re-read what is available. Called when settings or models change."""
        self._load_devices()

        usable, reason = self._service.available()
        self.toggle_button.setEnabled(usable)
        if usable:
            model = self._settings.dictation.model_id
            self.status.setText(
                f"Using {model}. Text appears when you pause, usually under a "
                f"second after each phrase, not word by word."
            )
        else:
            self.status.setText(reason)

        injectable, inject_reason = self._injector.available()
        self.inject_check.setEnabled(injectable)
        self.inject_note.setText(
            inject_reason if not injectable else
            "Windows will not let any program type into one running as "
            "administrator. For those, dictate here and paste."
        )

        if self._hotkeys is not None:
            ok, message = self._hotkeys.available()
            self.hotkey_label.setText(
                f"Shortcut: {self._settings.dictation.hotkey}. {message}"
                if ok else message
            )
        else:
            self.hotkey_label.setText("")

    def _load_devices(self) -> None:
        self.device_box.blockSignals(True)
        self.device_box.clear()
        self.device_box.addItem("System default", "")
        for device in capture.list_devices():
            self.device_box.addItem(str(device), str(device.index))
        chosen = self._settings.dictation.input_device
        index = self.device_box.findData(chosen)
        self.device_box.setCurrentIndex(max(0, index))
        self.device_box.setEnabled(self.device_box.count() > 1)
        self.device_box.blockSignals(False)

    def _save_options(self) -> None:
        from ..core.settings import save as save_settings

        d = self._settings.dictation
        d.inject_into_focused_app = self.inject_check.isChecked()
        d.apply_corrections = self.correct_check.isChecked()
        d.input_device = self.device_box.currentData() or ""
        save_settings(self._settings)

    # -- listening -------------------------------------------------------

    def toggle(self) -> None:
        if self._service.listening:
            self._service.stop()
            self._timer.stop()
            self.meter.setValue(0)
            return

        ok, message = self._service.start()
        if not ok:
            QMessageBox.warning(self, "Dictation could not start", message)
            return
        self._timer.start()

    def _tick(self) -> None:
        # A meter that only moves with real loudness is more use than one that
        # is always half full, so the scale is compressed rather than linear.
        level = min(1.0, self._service.level * 12)
        self.meter.setValue(int(level * 100))

    def _on_state(self, state: str) -> None:
        self.state_label.setText(STATE_WORDS.get(state, state))
        listening = state in (State.LISTENING, State.THINKING)
        self.toggle_button.setText("Stop dictation" if listening else "Start dictation")

    def _on_phrase(self, phrase: Phrase) -> None:
        joiner = spacing_before(self._text, phrase.text)
        self._text += joiner + phrase.text
        self.editor.setPlainText(self._text)
        cursor = self.editor.textCursor()
        cursor.movePosition(cursor.MoveOperation.End)
        self.editor.setTextCursor(cursor)

        if self._settings.dictation.inject_into_focused_app:
            result = self._injector.send(joiner + phrase.text)
            if not result.ok and result.message:
                self.status.setText(result.message)

    def _on_error(self, message: str) -> None:
        self.status.setText(message)

    # -- clipboard -------------------------------------------------------

    def copy(self) -> None:
        QApplication.clipboard().setText(self.editor.toPlainText())

    def clear(self) -> None:
        self._text = ""
        self.editor.clear()

    def hotkey_pressed(self) -> None:
        """The global shortcut fired. Toggle or hold, per the setting."""
        self.toggle()
