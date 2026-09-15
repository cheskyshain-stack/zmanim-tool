"""The engine interface and registry: the thing that makes models swappable."""

from __future__ import annotations

import pytest

from app.asr import registry as asr_registry
from app.asr.base import AsrEngine, TranscribeOptions
from app.asr.demo_engine import DemoAsrEngine, register_into
from app.ocr import registry as ocr_registry


@pytest.fixture(autouse=True)
def clean_registry():
    asr_registry.reset()
    ocr_registry.reset()
    yield
    asr_registry.reset()
    ocr_registry.reset()


def test_an_engine_registers_and_comes_back(tmp_path):
    register_into(asr_registry)
    assert "demo" in asr_registry.available_ids()
    assert isinstance(asr_registry.get("demo"), AsrEngine)


def test_an_unknown_engine_names_the_ones_that_exist():
    register_into(asr_registry)
    with pytest.raises(KeyError) as excinfo:
        asr_registry.get("faster_whisper")
    assert "demo" in str(excinfo.value), "the error must help, not just refuse"


def test_transcription_produces_timings_and_text(tmp_path):
    register_into(asr_registry)
    transcript = asr_registry.get("demo").transcribe(tmp_path / "a.m4a", TranscribeOptions())

    assert transcript.segments
    assert transcript.duration > 0
    assert transcript.text().strip()
    for previous, current in zip(transcript.segments, transcript.segments[1:]):
        assert current.start >= previous.end, "segments must not overlap"
    for segment in transcript.segments:
        assert segment.words, "word timings are needed for click to seek"
        assert segment.words[0].start >= segment.start
        assert segment.words[-1].end <= segment.end + 0.01


def test_progress_reaches_one_and_never_exceeds_it(tmp_path):
    register_into(asr_registry)
    events = []
    asr_registry.get("demo").transcribe(
        tmp_path / "a.m4a", TranscribeOptions(), on_progress=events.append
    )
    assert events
    assert all(0.0 <= e.fraction <= 1.0 for e in events)
    assert events[-1].fraction == pytest.approx(1.0, abs=0.15)


def test_cancelling_stops_early_and_says_so(tmp_path):
    register_into(asr_registry)
    calls = {"n": 0}

    def cancel_after_two() -> bool:
        calls["n"] += 1
        return calls["n"] > 2

    transcript = asr_registry.get("demo").transcribe(
        tmp_path / "a.m4a", TranscribeOptions(), should_cancel=cancel_after_two
    )
    assert len(transcript.segments) < 5
    assert transcript.complete is False, "a cancelled job must not look finished"


def test_segment_lookup_by_time(tmp_path):
    register_into(asr_registry)
    transcript = asr_registry.get("demo").transcribe(tmp_path / "a.m4a", TranscribeOptions())
    middle = transcript.segments[2]
    found = transcript.segment_at((middle.start + middle.end) / 2)
    assert found is middle, "clicking the transcript must find the right moment"


def test_capabilities_are_declared_honestly():
    engine = DemoAsrEngine()
    usable, reason = engine.is_available()
    assert usable and reason
    assert engine.capabilities.word_timestamps is True
    assert engine.capabilities.gpu is False


def test_the_ocr_registry_has_the_same_shape():
    """One shape to learn. A future engine plugs in the same way on both sides."""
    assert ocr_registry.available_ids() == []
    with pytest.raises(KeyError):
        ocr_registry.get("tesseract")
