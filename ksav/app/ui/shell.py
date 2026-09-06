"""The main window: navigation rail, header, and the screen stack.

The readiness logic lives here rather than in each screen because the question
"can this computer do the thing you are about to ask for" has one answer and
should be phrased one way. The status pill and the home screen both read it from
:meth:`_evaluate_readiness`.
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import (
    QButtonGroup,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from ..core.logging import get
from ..core.settings import Settings, save as save_settings
from ..platform import media
from ..platform.hardware import Hardware, Recommendation
from ..platform.models import BY_ID, ModelManager
from . import coming_soon
from .home import HomeView
from .model_vault import ModelVaultView
from .palette import for_theme, stylesheet
from .settings_view import SettingsView
from .widgets import StatusPill

log = get(__name__)

NAV = [
    ("home", "Home"),
    ("transcribe", "Transcribe Recording"),
    ("dictation", "Live Dictation"),
    ("ocr", "Extract Text / OCR"),
    ("dictionary", "Dictionary"),
    ("vault", "Model Vault"),
    ("settings", "Settings"),
]


class Shell(QWidget):
    def __init__(
        self,
        settings: Settings,
        hardware: Hardware,
        recommendation: Recommendation,
        manager: ModelManager,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.setObjectName("Root")
        self._settings = settings
        self._hardware = hardware
        self._manager = manager

        root = QHBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        root.addWidget(self._build_rail())

        right = QVBoxLayout()
        right.setContentsMargins(30, 24, 30, 24)
        right.setSpacing(18)
        right.addLayout(self._build_header())

        self.stack = QStackedWidget()
        right.addWidget(self.stack, 1)

        holder = QWidget()
        holder.setLayout(right)
        root.addWidget(holder, 1)

        # -- screens
        self.home = HomeView()
        self.home.navigate.connect(self.show_section)

        self.vault = ModelVaultView(manager, hardware)
        self.vault.changed.connect(self._on_models_changed)

        self.settings_view = SettingsView(settings, hardware, recommendation, manager)
        self.settings_view.navigate.connect(self.show_section)
        self.settings_view.settings_changed.connect(self._evaluate_readiness)

        self._screens = {
            "home": self.home,
            "transcribe": coming_soon.transcribe_view(),
            "dictation": coming_soon.dictation_view(),
            "ocr": coming_soon.ocr_view(),
            "dictionary": coming_soon.dictionary_view(),
            "vault": self.vault,
            "settings": self.settings_view,
        }
        for widget in self._screens.values():
            self.stack.addWidget(widget)

        self.show_section(settings.ui.last_section if settings.ui.last_section in self._screens else "home")
        self._evaluate_readiness()

    # -- construction ----------------------------------------------------

    def _build_rail(self) -> QWidget:
        rail = QWidget()
        rail.setObjectName("NavRail")
        rail.setFixedWidth(226)

        layout = QVBoxLayout(rail)
        layout.setContentsMargins(14, 20, 14, 16)
        layout.setSpacing(3)

        wordmark = QLabel("Ksav")
        wordmark.setObjectName("WordMark")
        sub = QLabel("Offline transcription and OCR")
        sub.setObjectName("WordMarkSub")
        sub.setWordWrap(True)
        layout.addWidget(wordmark)
        layout.addWidget(sub)
        layout.addSpacing(16)

        self._nav_group = QButtonGroup(self)
        self._nav_group.setExclusive(True)
        self._nav_buttons: dict[str, QPushButton] = {}

        for key, label in NAV:
            if key == "vault":
                layout.addStretch(1)
            btn = QPushButton(label)
            btn.setObjectName("NavItem")
            btn.setCheckable(True)
            btn.setCursor(Qt.PointingHandCursor)
            btn.clicked.connect(lambda _checked=False, k=key: self.show_section(k))
            self._nav_group.addButton(btn)
            self._nav_buttons[key] = btn
            layout.addWidget(btn)

        return rail

    def _build_header(self) -> QHBoxLayout:
        header = QHBoxLayout()
        header.setSpacing(12)
        header.addStretch(1)
        self.pill = StatusPill()
        header.addWidget(self.pill, 0, Qt.AlignRight | Qt.AlignVCenter)
        return header

    # -- behaviour -------------------------------------------------------

    def show_section(self, key: str) -> None:
        widget = self._screens.get(key)
        if widget is None:
            return
        self.stack.setCurrentWidget(widget)
        button = self._nav_buttons.get(key)
        if button:
            button.setChecked(True)
        self._settings.ui.last_section = key

    def _on_models_changed(self) -> None:
        self.settings_view.refresh_models()
        self._evaluate_readiness()

    def _evaluate_readiness(self) -> None:
        """One answer to 'can this computer work right now', phrased one way."""
        chosen_id = self._settings.transcription.model_id
        chosen = BY_ID.get(chosen_id)
        installed = self._manager.installed_ids()

        if chosen and self._manager.is_installed(chosen_id):
            self.pill.set_state(
                StatusPill.OK,
                "OFFLINE · Processing locally",
                "Everything this task needs is on this computer. "
                "You can disconnect the network.",
            )
            self.home.set_readiness(
                True,
                f"{chosen.name} is installed and ready. Nothing you transcribe or scan "
                "leaves this computer.",
                f"Using {self._hardware.summary()}.",
            )
            return

        if installed:
            other = BY_ID[installed[0]]
            self.pill.set_state(
                StatusPill.WARN,
                "OFFLINE · Different model selected",
                f"{chosen.name if chosen else chosen_id} is not installed, "
                f"but {other.name} is.",
            )
            self.home.set_readiness(
                False,
                f"{chosen.name if chosen else chosen_id} is not installed yet, "
                f"though {other.name} is. Pick it in Settings, or download the one you want.",
                "No internet is needed once a model is on this computer.",
            )
            return

        # Before telling anyone to go online, check whether a model is already
        # sitting on a USB stick or beside the program.
        waiting = self._manager.discover_all()
        if waiting:
            where = media.describe(next(iter(waiting.values())))
            count = len(waiting)
            self.pill.set_state(
                StatusPill.WARN,
                "OFFLINE · Model ready to install",
                f"{count} model{'s' if count != 1 else ''} found on {where}.",
            )
            self.home.set_readiness(
                False,
                f"{count} model{'s' if count != 1 else ''} ready to install from {where}. "
                "This takes a minute and needs no internet connection.",
                "Open the Model Vault and press Install them all.",
            )
            return

        self.pill.set_state(
            StatusPill.DANGER,
            "OFFLINE · Model needed",
            "Transcription needs a speech model on this computer before it can run.",
        )
        self.home.set_readiness(
            False,
            "No speech model is installed yet. Ksav needs one, either downloaded once "
            "or copied across from a USB stick. After that it never uses the internet again.",
            f"The Model Vault recommends a model that suits {self._hardware.summary()}.",
        )

    def apply_theme(self) -> None:
        app = QGuiApplication.instance()
        dark = False
        try:
            from PySide6.QtGui import QPalette
            from PySide6.QtWidgets import QApplication

            widget_app = QApplication.instance()
            if widget_app:
                window = widget_app.palette().color(QPalette.Window)
                dark = window.lightness() < 128
        except Exception:
            dark = False
        palette = for_theme(self._settings.ui.theme, dark)
        if app:
            self.window().setStyleSheet(stylesheet(palette))

    def persist(self) -> None:
        self._settings.ui.window_width = self.window().width()
        self._settings.ui.window_height = self.window().height()
        save_settings(self._settings)
