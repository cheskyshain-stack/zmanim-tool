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
from .dictionary_view import DictionaryView
from .home import HomeView
from .ocr_review import OcrReviewView
from .ocr_view import OcrView
from .transcribe_view import TranscribeView
from .transcript_view import TranscriptView
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
        lexicon=None,
        queue=None,
        service=None,
        ocr_queue=None,
        ocr_service=None,
    ) -> None:
        super().__init__(parent)
        self.setObjectName("Root")
        self._settings = settings
        self._hardware = hardware
        self._manager = manager
        self._lexicon = lexicon
        self._queue = queue
        self._service = service
        self._ocr_queue = ocr_queue
        self._ocr_service = ocr_service

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

        # Phase 1 screens are real when the services behind them exist; the
        # honest placeholder stands in when the shell is built without them,
        # which is how the interface tests run without a queue.
        if self._queue is not None:
            self.transcribe = TranscribeView(self._queue, settings)
            self.transcribe.open_transcript.connect(self.open_transcript)
        else:
            self.transcribe = coming_soon.transcribe_view()

        if self._lexicon is not None:
            self.dictionary = DictionaryView(self._lexicon)
            self.dictionary.changed.connect(self._on_dictionary_changed)
        else:
            self.dictionary = coming_soon.dictionary_view()

        if self._ocr_queue is not None:
            self.ocr = OcrView(self._ocr_queue, settings)
            self.ocr.open_document.connect(self.open_document)
        else:
            self.ocr = coming_soon.ocr_view()

        self.transcript = TranscriptView(settings, self._categories())
        self.ocr_review = OcrReviewView(settings)

        self._screens = {
            "home": self.home,
            "transcribe": self.transcribe,
            "dictation": coming_soon.dictation_view(),
            "ocr": self.ocr,
            "dictionary": self.dictionary,
            "vault": self.vault,
            "settings": self.settings_view,
            "transcript": self.transcript,
            "ocr_review": self.ocr_review,
        }
        for widget in self._screens.values():
            self.stack.addWidget(widget)

        start = settings.ui.last_section
        # Never reopen straight into a transcript that is no longer loaded.
        if start not in self._screens or start in ("transcript", "ocr_review"):
            start = "home"
        self.show_section(start)
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
        elif key in ("transcript", "ocr_review"):
            # Reached from a queue rather than the rail. Keep the queue that led
            # here lit, because that is where Back goes.
            parent = "transcribe" if key == "transcript" else "ocr"
            self._nav_buttons[parent].setChecked(True)
        self._settings.ui.last_section = key

    def _categories(self) -> dict[str, str]:
        """Entry id to category, which is how Mode C decides per term."""
        if self._lexicon is None:
            return {}
        return {e.id: e.category for e in self._lexicon.all()}

    def _on_dictionary_changed(self) -> None:
        # The matcher index is built from the dictionary, so an edit invalidates
        # it. Rebuilding is a few milliseconds, so this is not worth being clever
        # about.
        if self._service is not None:
            self._service.invalidate_index()
        self.transcript._categories = self._categories()

    def open_transcript(self, path: str) -> None:
        """Show a finished transcript. Reached from the queue's Open button."""
        if self._service is None or not path:
            return
        try:
            corrected = self._service.store.load(path)
        except (OSError, ValueError, KeyError) as exc:
            log.warning("could not open transcript %s: %s", path, exc)
            return
        self.transcript.load(corrected, self._categories())
        self.show_section("transcript")

    def open_document(self, path: str) -> None:
        """Show a finished page document. Reached from the OCR queue."""
        if self._ocr_service is None or not path:
            return
        try:
            document = self._ocr_service.store.load(path)
        except (OSError, ValueError, KeyError) as exc:
            log.warning("could not open document %s: %s", path, exc)
            return
        self.ocr_review.load(document)
        self.show_section("ocr_review")

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
