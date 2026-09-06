"""Settings.

Grouped the way the brief listed them, with two additions. The hardware card
shows what was detected and what Ksav recommends because of it, since a
recommendation the user cannot see the reasoning for is just a mystery default.
The privacy card states what the application does not do, which is the part
worth being explicit about.
"""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from ..core.models import MODE_LABELS, OutputMode
from ..core.settings import Settings, save as save_settings
from ..platform.hardware import Hardware, Recommendation
from ..platform.models import ModelManager, asr_models
from .widgets import Card, KeyValueGrid, button, caption

QUALITY_LABELS = [
    ("accuracy", "Accuracy first (slowest)"),
    ("balanced", "Balanced"),
    ("speed", "Speed first (least accurate)"),
]

LANGUAGE_CHOICES = [
    ("en", "English carrier (Yeshivish English)"),
    ("he", "Hebrew"),
    ("yi", "Yiddish"),
    (None, "Detect for each recording"),
]

OCR_LANGUAGE_SETS = [
    (["heb", "eng"], "Hebrew and English"),
    (["heb"], "Hebrew only"),
    (["eng"], "English only"),
    (["yid", "heb", "eng"], "Yiddish, Hebrew and English"),
]


class SettingsView(QWidget):
    settings_changed = Signal()
    navigate = Signal(str)

    def __init__(
        self,
        settings: Settings,
        hardware: Hardware,
        recommendation: Recommendation,
        manager: ModelManager,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._settings = settings
        self._hardware = hardware
        self._recommendation = recommendation
        self._manager = manager
        self._loading = True

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(16)

        title = QLabel("Settings")
        title.setObjectName("PageTitle")
        outer.addWidget(title)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.NoFrame)
        inner = QWidget()
        self._column = QVBoxLayout(inner)
        self._column.setContentsMargins(0, 0, 10, 0)
        self._column.setSpacing(14)
        scroll.setWidget(inner)
        outer.addWidget(scroll, 1)

        self._build_hardware_card()
        self._build_transcription_card()
        self._build_language_card()
        self._build_ocr_card()
        self._build_dictation_card()
        self._build_files_card()
        self._build_privacy_card()
        self._column.addStretch(1)

        self._loading = False

    # -- cards -----------------------------------------------------------

    def _build_hardware_card(self) -> None:
        card = Card("This computer")
        grid = KeyValueGrid()
        grid.add("Processor", self._hardware.cpu_name)
        grid.add(
            "Cores and memory",
            f"{self._hardware.physical_cores} physical, "
            f"{self._hardware.logical_cores} logical, {self._hardware.ram_gb:g} GB RAM",
        )
        if self._hardware.gpus:
            for gpu in self._hardware.gpus:
                vram = f", {gpu.vram_gb:g} GB VRAM" if gpu.vram_gb else ""
                grid.add("Graphics", f"{gpu.name}{vram}")
        else:
            grid.add("Graphics", "No dedicated graphics card found")
        grid.add(
            "CUDA",
            f"Available, version {self._hardware.cuda_version}"
            if self._hardware.cuda_available
            else "Not available. Ksav runs on the processor instead.",
        )
        card.add(grid)

        recommended = Card("")
        note = QLabel(
            f"Recommended: {self._recommendation.asr_model} on "
            f"{'the graphics card' if self._recommendation.device == 'cuda' else 'the processor'}, "
            f"{self._recommendation.speed_note}."
        )
        note.setWordWrap(True)
        card.add(note)
        card.add(caption(self._recommendation.reason))
        self._column.addWidget(card)

    def _build_transcription_card(self) -> None:
        card = Card("Transcription")
        t = self._settings.transcription

        self.model_box = QComboBox()
        for spec in asr_models():
            installed = self._manager.is_installed(spec.id)
            mark = "" if installed else "   (not installed)"
            self.model_box.addItem(f"{spec.name}{mark}", spec.id)
        self._select(self.model_box, t.model_id)
        self.model_box.currentIndexChanged.connect(self._apply)
        card.add_row("Transcription model", self.model_box,
                     "Larger models are more accurate and slower.")

        self.quality_box = QComboBox()
        for value, label in QUALITY_LABELS:
            self.quality_box.addItem(label, value)
        self._select(self.quality_box, t.quality)
        self.quality_box.currentIndexChanged.connect(self._apply)
        card.add_row("Accuracy or speed", self.quality_box,
                     "Changes how hard the model searches for each word.")

        self.language_box = QComboBox()
        for value, label in LANGUAGE_CHOICES:
            self.language_box.addItem(label, value)
        self._select(self.language_box, t.language)
        self.language_box.currentIndexChanged.connect(self._apply)
        card.add_row("Spoken language", self.language_box,
                     "Yeshivish speech carried in English belongs on the first option, "
                     "even when a sentence is full of Torah terminology.")

        self.device_box = QComboBox()
        for value, label in [("auto", "Choose automatically"), ("cuda", "Graphics card"),
                             ("cpu", "Processor")]:
            self.device_box.addItem(label, value)
        self._select(self.device_box, t.device)
        self.device_box.currentIndexChanged.connect(self._apply)
        card.add_row("Run on", self.device_box)

        self.prime_check = QCheckBox("Use the dictionary to help recognition")
        self.prime_check.setChecked(t.prime_with_dictionary)
        self.prime_check.stateChanged.connect(self._apply)
        card.add(self.prime_check)
        card.add(caption(
            "Sends a ranked selection of your Torah terms to the model before it decides "
            "on a word, rather than only correcting the result afterwards."
        ))

        self.vad_check = QCheckBox("Skip silence (recommended)")
        self.vad_check.setChecked(t.vad_filter)
        self.vad_check.stateChanged.connect(self._apply)
        card.add(self.vad_check)
        card.add(caption(
            "Whisper invents text during long silences. This removes the silence before "
            "it gets the chance."
        ))
        self._column.addWidget(card)

    def _build_language_card(self) -> None:
        card = Card("Output language")
        self.mode_box = QComboBox()
        for mode in OutputMode:
            self.mode_box.addItem(MODE_LABELS[mode], mode.value)
        self._select(self.mode_box, self._settings.language.output_mode)
        self.mode_box.currentIndexChanged.connect(self._apply)
        card.add_row("Output mode", self.mode_box,
                     "You can switch between all four on any transcript without "
                     "transcribing again.")

        example = QLabel(
            "Yeshivish English:   The Gemara asks a kashya on Rav Huna.\n"
            "Hebrew script:   The גמרא asks a קשיא on רב הונא."
        )
        example.setObjectName("Hebrew")
        example.setWordWrap(True)
        card.add(example)

        self.risky_check = QCheckBox("Risky corrections need supporting context")
        self.risky_check.setChecked(self._settings.language.require_context_for_risky)
        self.risky_check.stateChanged.connect(self._apply)
        card.add(self.risky_check)
        card.add(caption(
            "Keeps a term like camera from becoming Gemara in a sentence that is actually "
            "about a camera. Turning this off makes corrections more aggressive."
        ))

        self.phonetic_check = QCheckBox("Suggest corrections for words not in the dictionary")
        self.phonetic_check.setChecked(self._settings.language.enable_phonetic_suggestions)
        self.phonetic_check.stateChanged.connect(self._apply)
        card.add(self.phonetic_check)
        card.add(caption("Offered for review. Never applied on its own."))

        row = QHBoxLayout()
        row.addStretch(1)
        row.addWidget(button("Open the dictionary", lambda: self.navigate.emit("dictionary")))
        holder = QWidget()
        holder.setLayout(row)
        card.add(holder)
        self._column.addWidget(card)

    def _build_ocr_card(self) -> None:
        card = Card("Reading pages")
        self.ocr_lang_box = QComboBox()
        for value, label in OCR_LANGUAGE_SETS:
            self.ocr_lang_box.addItem(label, value)
        current = self._settings.ocr.languages
        for i in range(self.ocr_lang_box.count()):
            if self.ocr_lang_box.itemData(i) == current:
                self.ocr_lang_box.setCurrentIndex(i)
                break
        self.ocr_lang_box.currentIndexChanged.connect(self._apply)
        card.add_row("Page languages", self.ocr_lang_box)

        self.dpi_box = QComboBox()
        for dpi in (200, 300, 400, 600):
            self.dpi_box.addItem(f"{dpi} dpi", dpi)
        self._select(self.dpi_box, self._settings.ocr.dpi)
        self.dpi_box.currentIndexChanged.connect(self._apply)
        card.add_row("PDF rendering detail", self.dpi_box,
                     "Higher is slower and reads small print better.")

        self.preprocess_check = QCheckBox("Clean up the image first (deskew, denoise, contrast)")
        self.preprocess_check.setChecked(self._settings.ocr.preprocess)
        self.preprocess_check.stateChanged.connect(self._apply)
        card.add(self.preprocess_check)

        self.textlayer_check = QCheckBox("Use a PDF's own text when it already has some")
        self.textlayer_check.setChecked(self._settings.ocr.use_pdf_text_layer)
        self.textlayer_check.stateChanged.connect(self._apply)
        card.add(self.textlayer_check)
        card.add(caption(
            "Far faster and perfectly accurate when the PDF was made from a computer file "
            "rather than scanned."
        ))
        self._column.addWidget(card)

    def _build_dictation_card(self) -> None:
        card = Card("Dictation")
        d = self._settings.dictation
        card.add(caption(
            "Dictation arrives in Phase 3. These settings are stored now so the shortcut "
            "you choose is already in place when it does."
        ))

        self.hotkey_label = QLabel(d.hotkey)
        self.hotkey_label.setObjectName("Mono")
        card.add_row("Global shortcut", self.hotkey_label,
                     "Press this anywhere in Windows to dictate into whatever you are typing in.")

        self.hotkey_mode_box = QComboBox()
        for value, label in [("toggle", "Press once to start, once to stop"),
                             ("push_to_talk", "Hold to speak")]:
            self.hotkey_mode_box.addItem(label, value)
        self._select(self.hotkey_mode_box, d.hotkey_mode)
        self.hotkey_mode_box.currentIndexChanged.connect(self._apply)
        card.add_row("Shortcut behaviour", self.hotkey_mode_box)
        self._column.addWidget(card)

    def _build_files_card(self) -> None:
        card = Card("Files")
        e = self._settings.export

        row = QHBoxLayout()
        row.setSpacing(8)
        self.folder_label = QLabel(e.default_folder or "Ask each time")
        self.folder_label.setObjectName("Mono")
        self.folder_label.setWordWrap(True)
        row.addWidget(self.folder_label, 1)
        row.addWidget(button("Choose", self._pick_folder))
        holder = QWidget()
        holder.setLayout(row)
        card.add_row("Default export folder", holder)

        self.keep_audio_check = QCheckBox("Keep the original recording after transcribing")
        self.keep_audio_check.setChecked(self._settings.transcription.keep_original_audio)
        self.keep_audio_check.stateChanged.connect(self._apply)
        card.add(self.keep_audio_check)

        self.keep_temp_check = QCheckBox("Keep working files (converted audio, page images)")
        self.keep_temp_check.setChecked(e.keep_processing_files)
        self.keep_temp_check.stateChanged.connect(self._apply)
        card.add(self.keep_temp_check)
        card.add(caption("Working files are deleted when a job finishes unless this is on."))
        self._column.addWidget(card)

    def _build_privacy_card(self) -> None:
        card = Card("Privacy")
        grid = KeyValueGrid()
        grid.add("Account", "None. Ksav has no sign in and no licence check.")
        grid.add("Your content", "Recordings, images, documents and text never leave this computer.")
        grid.add("Telemetry", "None. No usage data is collected or sent.")
        grid.add("Update checks", "None. Ksav does not contact a server on startup.")
        grid.add("Internet use", "Only when you press Download in the Model Vault.")
        card.add(grid)

        row = QHBoxLayout()
        row.addStretch(1)
        row.addWidget(button("Open Model Vault", lambda: self.navigate.emit("vault")))
        holder = QWidget()
        holder.setLayout(row)
        card.add(holder)
        self._column.addWidget(card)

    # -- plumbing --------------------------------------------------------

    @staticmethod
    def _select(box: QComboBox, value) -> None:
        for i in range(box.count()):
            if box.itemData(i) == value:
                box.setCurrentIndex(i)
                return

    def _pick_folder(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, "Choose a default export folder")
        if folder:
            self._settings.export.default_folder = folder
            self.folder_label.setText(folder)
            self._apply()

    def _apply(self, *_args) -> None:
        if self._loading:
            return
        t = self._settings.transcription
        t.model_id = self.model_box.currentData()
        t.quality = self.quality_box.currentData()
        t.language = self.language_box.currentData()
        t.device = self.device_box.currentData()
        t.prime_with_dictionary = self.prime_check.isChecked()
        t.vad_filter = self.vad_check.isChecked()
        t.keep_original_audio = self.keep_audio_check.isChecked()

        lang = self._settings.language
        lang.output_mode = self.mode_box.currentData()
        lang.require_context_for_risky = self.risky_check.isChecked()
        lang.enable_phonetic_suggestions = self.phonetic_check.isChecked()

        ocr = self._settings.ocr
        ocr.languages = list(self.ocr_lang_box.currentData())
        ocr.dpi = self.dpi_box.currentData()
        ocr.preprocess = self.preprocess_check.isChecked()
        ocr.use_pdf_text_layer = self.textlayer_check.isChecked()

        self._settings.dictation.hotkey_mode = self.hotkey_mode_box.currentData()
        self._settings.export.keep_processing_files = self.keep_temp_check.isChecked()

        save_settings(self._settings)
        self.settings_changed.emit()

    def refresh_models(self) -> None:
        """Re-label the model list after something is installed or removed."""
        self._loading = True
        current = self.model_box.currentData()
        self.model_box.clear()
        for spec in asr_models():
            mark = "" if self._manager.is_installed(spec.id) else "   (not installed)"
            self.model_box.addItem(f"{spec.name}{mark}", spec.id)
        self._select(self.model_box, current)
        self._loading = False
