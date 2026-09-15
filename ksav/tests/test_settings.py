"""Settings must survive being written by a newer build and read by an older one."""

from __future__ import annotations

import json

from app.core import settings as S
from app.core.models import OutputMode


def test_defaults_are_sensible():
    s = S.Settings()
    assert s.transcription.language == "en", "Yeshivish carried in English is the common case"
    assert s.transcription.vad_filter is True, "silence gating is on by default for a reason"
    assert s.language.output_mode == OutputMode.YESHIVISH_ENGLISH.value
    assert s.privacy.telemetry is False
    assert s.privacy.update_check is False


def test_missing_file_gives_defaults(tmp_path):
    assert S.load(tmp_path / "nothing.json").transcription.model_id == "whisper-medium"


def test_corrupt_file_gives_defaults_rather_than_crashing(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text("{ this is not json", encoding="utf-8")
    assert S.load(path).transcription.quality == "balanced"


def test_out_of_range_values_are_clamped(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({
        "transcription": {"quality": "nonsense", "paragraph_pause": 0.01},
        "language": {"output_mode": "klingon", "confidence_threshold": 9.0},
        "ocr": {"dpi": 999, "languages": []},
    }), encoding="utf-8")
    s = S.load(path)
    assert s.transcription.quality == "balanced"
    assert s.transcription.paragraph_pause == 0.3
    assert s.language.output_mode == OutputMode.YESHIVISH_ENGLISH.value
    assert s.language.confidence_threshold == 1.0
    assert s.ocr.dpi == 300
    assert s.ocr.languages == ["heb", "eng"]


def test_a_users_own_choice_is_never_clamped_away(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"transcription": {"model_id": "ivrit-turbo"}}), encoding="utf-8")
    assert S.load(path).transcription.model_id == "ivrit-turbo"


def test_keys_from_a_newer_build_survive_a_round_trip(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({
        "future_section": {"enabled": True},
        "transcription": {"model_id": "whisper-large-v3", "future_option": 42},
    }), encoding="utf-8")

    S.save(S.load(path), path)
    written = json.loads(path.read_text(encoding="utf-8"))

    assert written["future_section"] == {"enabled": True}
    assert written["transcription"]["future_option"] == 42
    assert written["transcription"]["model_id"] == "whisper-large-v3"


def test_a_superseded_default_is_carried_forward(tmp_path, monkeypatch):
    """The pattern for changing a shipped default without overwriting a choice."""
    monkeypatch.setattr(S, "LEGACY_DEFAULT_MODEL", ["whisper-tiny"])
    path = tmp_path / "settings.json"

    path.write_text(json.dumps({"transcription": {"model_id": "whisper-tiny"}}), encoding="utf-8")
    assert S.load(path).transcription.model_id == "whisper-medium", "old default upgraded"

    path.write_text(json.dumps({"transcription": {"model_id": "whisper-small"}}), encoding="utf-8")
    assert S.load(path).transcription.model_id == "whisper-small", "a real choice is left alone"


def test_save_is_atomic(tmp_path):
    path = tmp_path / "settings.json"
    S.save(S.Settings(), path)
    assert path.is_file()
    assert not list(tmp_path.glob("*.tmp")), "no temporary file is left behind"
