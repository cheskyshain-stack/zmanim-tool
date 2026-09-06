"""Settings: one JSON file, typed, versioned, and safe to hand edit.

Two rules that come from experience rather than taste:

* An unknown key in the file is kept, not dropped. A settings file written by a
  newer build must survive being opened by an older one.
* When a shipped default changes, the old default goes in a LEGACY list and is
  carried forward. That upgrades installs which never touched the setting while
  leaving anything the user chose by hand alone.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, field, fields, is_dataclass
from typing import Any

from . import paths
from .models import OutputMode

SCHEMA_VERSION = 1

# Defaults that shipped in an earlier build. If the stored value is one of
# these, it is replaced by the current default rather than treated as a choice.
LEGACY_DEFAULT_MODEL: list[str] = []


@dataclass
class _Group:
    """Base for every settings group.

    ``_unknown`` holds keys written by a newer build that this one does not
    recognise. They are carried through load and save untouched, so opening the
    file in an older build never silently discards a newer build's settings.
    """

    _unknown: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class TranscriptionSettings(_Group):
    engine_id: str = "faster_whisper"
    model_id: str = "whisper-medium"
    # "accuracy" | "balanced" | "speed". Maps onto beam size and model tier.
    quality: str = "balanced"
    # Forced language. "en" suits English carrier Yeshivish, which is the common
    # case; None lets the engine detect, which is right for a Yiddish shiur.
    language: str | None = "en"
    compute_type: str = "auto"          # auto | int8 | int8_float16 | float16 | float32
    device: str = "auto"                # auto | cpu | cuda
    vad_filter: bool = True             # gates Whisper's silence hallucination
    word_timestamps: bool = True
    diarize: bool = False
    # Seconds of silence that start a new paragraph.
    paragraph_pause: float = 1.6
    prime_with_dictionary: bool = True  # feed hotwords to the decoder
    keep_original_audio: bool = True


@dataclass
class DictationSettings(_Group):
    model_id: str = "whisper-small"
    input_device: str = ""              # empty means system default
    hotkey: str = "Ctrl+Alt+D"
    hotkey_mode: str = "toggle"         # toggle | push_to_talk
    inject_into_focused_app: bool = True
    injection_method: str = "sendinput"  # sendinput | clipboard
    apply_corrections: bool = True


@dataclass
class OcrSettings(_Group):
    engine_id: str = "tesseract"
    languages: list[str] = field(default_factory=lambda: ["heb", "eng"])
    preprocess: bool = True
    deskew: bool = True
    denoise: bool = True
    auto_orient: bool = True
    detect_columns: bool = True
    use_pdf_text_layer: bool = True     # skip OCR when the PDF already has text
    dpi: int = 300


@dataclass
class LanguageSettings(_Group):
    output_mode: str = OutputMode.YESHIVISH_ENGLISH.value
    # Below this, a match is offered as a suggestion instead of being applied.
    confidence_threshold: float = 0.75
    # Variants that are also ordinary English words never fire without context.
    require_context_for_risky: bool = True
    enable_phonetic_suggestions: bool = True
    hebrew_for_masechtos: bool = True   # Mode C hint
    hebrew_for_seforim: bool = False    # Mode C hint


@dataclass
class PrivacySettings(_Group):
    # Nothing in Ksav dials out unless this is switched on for a download.
    allow_model_downloads: bool = True
    # Deliberately no update check, no telemetry, no crash reporting. These
    # fields exist so the Settings screen can state that plainly.
    telemetry: bool = False
    update_check: bool = False


@dataclass
class ExportSettings(_Group):
    default_folder: str = ""
    include_timestamps: bool = False
    include_speakers: bool = True
    keep_processing_files: bool = False


@dataclass
class UiSettings(_Group):
    theme: str = "system"               # system | light | dark
    window_width: int = 1180
    window_height: int = 780
    last_section: str = "home"


@dataclass
class Settings:
    schema_version: int = SCHEMA_VERSION
    transcription: TranscriptionSettings = field(default_factory=TranscriptionSettings)
    dictation: DictationSettings = field(default_factory=DictationSettings)
    ocr: OcrSettings = field(default_factory=OcrSettings)
    language: LanguageSettings = field(default_factory=LanguageSettings)
    privacy: PrivacySettings = field(default_factory=PrivacySettings)
    export: ExportSettings = field(default_factory=ExportSettings)
    ui: UiSettings = field(default_factory=UiSettings)
    # Anything a newer build wrote that this one does not know about.
    _unknown: dict[str, Any] = field(default_factory=dict, repr=False)


def _as_dict(obj: Any) -> Any:
    if is_dataclass(obj):
        out = {}
        for f in fields(obj):
            if f.name == "_unknown":
                continue
            out[f.name] = _as_dict(getattr(obj, f.name))
        unknown = getattr(obj, "_unknown", None)
        if unknown:
            out.update(unknown)
        return out
    if isinstance(obj, list):
        return [_as_dict(v) for v in obj]
    return obj


def _fill(cls: type, data: dict) -> Any:
    """Build a settings dataclass from a dict, keeping keys we do not recognise."""
    known = {f.name: f for f in fields(cls)}
    kwargs: dict[str, Any] = {}
    unknown: dict[str, Any] = {}
    for key, value in data.items():
        f = known.get(key)
        if f is None or key == "_unknown":
            unknown[key] = value
            continue
        kwargs[key] = value
    obj = cls(**kwargs)
    if "_unknown" in known:
        obj._unknown = unknown
    return obj


def _fill_nested(data: dict) -> Settings:
    """Settings has nested dataclasses; resolve them by name rather than by type
    annotation, which is a string under ``from __future__ import annotations``."""
    groups = {
        "transcription": TranscriptionSettings,
        "dictation": DictationSettings,
        "ocr": OcrSettings,
        "language": LanguageSettings,
        "privacy": PrivacySettings,
        "export": ExportSettings,
        "ui": UiSettings,
    }
    kwargs: dict[str, Any] = {}
    unknown: dict[str, Any] = {}
    for key, value in data.items():
        if key in groups:
            kwargs[key] = _fill(groups[key], value or {})
        elif key == "schema_version":
            kwargs[key] = value
        else:
            unknown[key] = value
    for name, cls in groups.items():
        kwargs.setdefault(name, cls())
    settings = Settings(**kwargs)
    settings._unknown = unknown
    return settings


def normalize(settings: Settings) -> Settings:
    """Carry forward superseded defaults and clamp anything out of range."""
    t = settings.transcription
    if t.model_id in LEGACY_DEFAULT_MODEL:
        t.model_id = TranscriptionSettings.model_id
    if t.quality not in {"accuracy", "balanced", "speed"}:
        t.quality = "balanced"
    if t.paragraph_pause < 0.3:
        t.paragraph_pause = 0.3

    lang = settings.language
    if lang.output_mode not in {m.value for m in OutputMode}:
        lang.output_mode = OutputMode.YESHIVISH_ENGLISH.value
    lang.confidence_threshold = min(1.0, max(0.0, lang.confidence_threshold))

    if settings.ocr.dpi not in (150, 200, 300, 400, 600):
        settings.ocr.dpi = 300
    if not settings.ocr.languages:
        settings.ocr.languages = ["heb", "eng"]

    settings.schema_version = SCHEMA_VERSION
    return settings


def load(path=None) -> Settings:
    path = path or paths.SETTINGS_FILE
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return normalize(Settings())
    if not isinstance(data, dict):
        return normalize(Settings())
    return normalize(_fill_nested(data))


def save(settings: Settings, path=None) -> None:
    """Write atomically. A half written settings file is worse than none."""
    path = path or paths.SETTINGS_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(_as_dict(settings), indent=2, ensure_ascii=False)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
