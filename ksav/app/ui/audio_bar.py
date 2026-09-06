"""The playback strip under a transcript.

Qt Multimedia is not available on every machine (it needs platform audio
libraries that a stripped down system can lack), so the import is guarded and
the whole strip hides itself rather than taking the window down with it. A
transcript is still perfectly readable without a player.
"""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import QHBoxLayout, QLabel, QSlider, QWidget

from ..core.logging import get
from ..language.render import timestamp
from .widgets import button, caption

log = get(__name__)

try:
    from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
    AVAILABLE = True
except Exception as exc:                      # missing platform audio libraries
    log.info("audio playback unavailable: %s", exc)
    QAudioOutput = QMediaPlayer = None        # type: ignore
    AVAILABLE = False


class AudioBar(QWidget):
    """Play, pause, scrub, and seek to a moment the transcript points at."""

    position_changed = Signal(float)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._player = None
        self._output = None
        self._duration = 0.0
        self._scrubbing = False

        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(10)

        self.play_button = button("Play", self.toggle)
        self.play_button.setFixedWidth(76)
        layout.addWidget(self.play_button)

        self.slider = QSlider(Qt.Horizontal)
        self.slider.setRange(0, 1000)
        self.slider.sliderPressed.connect(self._grab)
        self.slider.sliderReleased.connect(self._release)
        layout.addWidget(self.slider, 1)

        self.time_label = QLabel("00:00:00 / 00:00:00")
        self.time_label.setObjectName("Mono")
        layout.addWidget(self.time_label)

        if not AVAILABLE:
            self.play_button.setEnabled(False)
            self.slider.setEnabled(False)
            self.time_label.setText("Playback unavailable")
            self.setToolTip(
                "Audio playback needs the system's media components, which are not "
                "available here. The transcript works normally."
            )
            return

        self._output = QAudioOutput()
        self._player = QMediaPlayer()
        self._player.setAudioOutput(self._output)
        self._player.positionChanged.connect(self._on_position)
        self._player.durationChanged.connect(self._on_duration)
        self._player.playbackStateChanged.connect(self._on_state)

    # -- loading ---------------------------------------------------------

    def load(self, path: Path | str) -> bool:
        """Point at a recording. False when it cannot be played."""
        if not AVAILABLE or self._player is None:
            return False
        path = Path(path)
        if not path.is_file():
            self.play_button.setEnabled(False)
            self.time_label.setText("Recording not found")
            self.setToolTip(
                f"{path.name} is no longer where it was when it was transcribed, "
                f"so it cannot be played. The transcript is unaffected."
            )
            return False
        from PySide6.QtCore import QUrl

        self._player.setSource(QUrl.fromLocalFile(str(path.resolve())))
        self.play_button.setEnabled(True)
        return True

    # -- control ---------------------------------------------------------

    def toggle(self) -> None:
        if not self._player:
            return
        if self._player.playbackState() == QMediaPlayer.PlayingState:
            self._player.pause()
        else:
            self._player.play()

    def seek(self, seconds: float) -> None:
        if self._player:
            self._player.setPosition(int(max(0.0, seconds) * 1000))

    def play_from(self, seconds: float) -> None:
        self.seek(seconds)
        if self._player and self._player.playbackState() != QMediaPlayer.PlayingState:
            self._player.play()

    def stop(self) -> None:
        if self._player:
            self._player.stop()

    # -- feedback --------------------------------------------------------

    def _grab(self) -> None:
        self._scrubbing = True

    def _release(self) -> None:
        self._scrubbing = False
        if self._duration:
            self.seek(self.slider.value() / 1000 * self._duration)

    def _on_duration(self, millis: int) -> None:
        self._duration = millis / 1000
        self._refresh_label(self._player.position() / 1000 if self._player else 0.0)

    def _on_position(self, millis: int) -> None:
        seconds = millis / 1000
        if self._duration and not self._scrubbing:
            self.slider.setValue(int(seconds / self._duration * 1000))
        self._refresh_label(seconds)
        self.position_changed.emit(seconds)

    def _on_state(self, state) -> None:
        playing = state == QMediaPlayer.PlayingState
        self.play_button.setText("Pause" if playing else "Play")

    def _refresh_label(self, seconds: float) -> None:
        self.time_label.setText(f"{timestamp(seconds)} / {timestamp(self._duration)}")
