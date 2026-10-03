"""Recording to exported file, and the things that go wrong along the way."""

from __future__ import annotations

import math
import struct
import time
import wave
import zipfile
from pathlib import Path

import pytest

from app.asr import registry as asr_registry
from app.asr.audio import decode
from app.asr.base import EngineUnavailable, TranscribeOptions
from app.asr.demo_engine import register_into
from app.core.models import OutputMode
from app.core.settings import Settings
from app.export import docx as docx_export
from app.export import subtitles, txt as txt_export
from app.language.lexicon import Lexicon
from app.services.job_queue import JobQueue, JobStatus
from app.services.transcription import TranscriptionService, TranscriptStore

SEED = "app/language/data/seed_lexicon.jsonl"


def make_wav(path: Path, seconds: float = 3.0, rate: int = 16000) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(b"".join(
            struct.pack("<h", int(3000 * math.sin(2 * math.pi * 220 * i / rate)))
            for i in range(int(rate * seconds))
        ))
    return path


@pytest.fixture(autouse=True)
def demo_engine():
    asr_registry.reset()
    register_into(asr_registry)
    yield
    asr_registry.reset()


@pytest.fixture
def service(tmp_path):
    settings = Settings()
    settings.transcription.engine_id = "demo"
    lexicon = Lexicon(tmp_path / "lex.sqlite")
    lexicon.seed_from(SEED)
    svc = TranscriptionService(settings, lexicon, TranscriptStore(tmp_path / "transcripts"))
    yield svc
    lexicon.close()


# -- audio --------------------------------------------------------------


def test_a_real_file_reports_its_duration(tmp_path):
    info = decode.probe(make_wav(tmp_path / "a.wav", 2.5))
    assert 2.4 < info.duration < 2.6
    assert info.sample_rate == 16000


def test_every_format_in_the_brief_is_accepted():
    for extension in ("mp3", "wav", "m4a", "mp4", "aac", "flac"):
        assert decode.is_supported(f"shiur.{extension}")
    assert not decode.is_supported("notes.docx")


def test_a_missing_file_says_so_in_plain_words(tmp_path):
    with pytest.raises(decode.AudioError) as excinfo:
        decode.probe(tmp_path / "nope.mp3")
    assert "could not be found" in str(excinfo.value)


def test_a_corrupt_file_fails_before_the_queue_takes_it(tmp_path):
    junk = tmp_path / "broken.mp3"
    junk.write_bytes(b"this is not audio")
    with pytest.raises(decode.AudioError):
        decode.probe(junk)


def test_duration_labels_read_like_a_person_wrote_them():
    assert decode.AudioInfo("x", 45).duration_label == "45s"
    assert decode.AudioInfo("x", 3 * 3600 + 900).duration_label == "3h 15m"


# -- priming ------------------------------------------------------------


def test_the_dictionary_reaches_the_decoder(service):
    hotwords, prompt = service.priming()
    assert hotwords and prompt
    assert "kashya" in hotwords


def test_the_prompt_stays_inside_whisper_s_cap(service):
    """Whisper truncates a prompt beyond roughly 224 tokens, silently."""
    _hotwords, prompt = service.priming()
    assert len(prompt.split()) < 200


def test_priming_can_be_switched_off(service):
    service.settings.transcription.prime_with_dictionary = False
    assert service.priming() == ([], None)


def test_settings_reach_the_engine_options(service):
    service.settings.transcription.quality = "speed"
    service.settings.transcription.language = "he"
    options = service.options_for()
    assert options.quality_key() == "speed"
    assert options.language == "he"
    assert options.hotwords


# -- the whole pipeline -------------------------------------------------


def test_a_recording_becomes_a_corrected_transcript(service, tmp_path):
    corrected = service.transcribe(make_wav(tmp_path / "shiur.wav"))
    assert corrected.transcript.segments
    assert corrected.applied_count > 0
    applied = {c.raw: c.canonical for c in corrected.corrections if c.applied}
    assert applied.get("camera") == "Gemara", "the dictionary did not reach the result"


def test_a_transcript_survives_a_round_trip_through_disk(service, tmp_path):
    corrected = service.transcribe(make_wav(tmp_path / "shiur.wav"))
    reloaded = service.store.load(service.store.path_for(corrected.transcript.id))

    assert reloaded.transcript.text() == corrected.transcript.text()
    assert len(reloaded.corrections) == len(corrected.corrections)
    assert reloaded.transcript.segments[0].words, "word timings were lost"


def test_the_queue_runs_a_job_to_completion(service, tmp_path):
    queue = JobQueue(service.make_runner(), tmp_path / "jobs")
    queue.start()
    job = queue.add(make_wav(tmp_path / "a.wav"))
    for _ in range(60):
        if not job.is_active:
            break
        time.sleep(0.05)
    queue.stop()

    assert job.status == JobStatus.DONE.value
    assert job.progress == 1.0
    assert Path(job.result_path).is_file()


def test_a_job_that_cannot_read_its_file_fails_usefully(service, tmp_path):
    queue = JobQueue(service.make_runner(), tmp_path / "jobs")
    queue.start()
    job = queue.add(tmp_path / "missing.mp3")
    for _ in range(40):
        if not job.is_active:
            break
        time.sleep(0.05)
    queue.stop()

    assert job.status == JobStatus.FAILED.value
    assert "could not be found" in job.error


def test_an_interrupted_job_comes_back_ready_to_resume(service, tmp_path):
    journal = tmp_path / "jobs"
    queue = JobQueue(service.make_runner(), journal)
    queue.start()
    job = queue.add(make_wav(tmp_path / "long.wav"))
    time.sleep(0.05)
    queue.stop(wait=0.1)

    # Whatever state it reached, force the crash case and reopen.
    import json

    path = journal / f"{job.id}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["status"] = "running"
    data["progress"] = 0.4
    path.write_text(json.dumps(data), encoding="utf-8")

    reopened = JobQueue(service.make_runner(), journal)
    restored = reopened.restore()
    assert restored
    recovered = reopened.get(job.id)
    assert recovered.status == JobStatus.INTERRUPTED.value
    assert "40 percent" in recovered.message


def test_cancelling_stops_the_work(service, tmp_path):
    slow_calls = {"n": 0}

    def runner(job, progress, cancelled):
        for i in range(200):
            if cancelled():
                break
            slow_calls["n"] += 1
            progress(i, 200, "working")
            time.sleep(0.005)
        return ""

    queue = JobQueue(runner, tmp_path / "jobs")
    queue.start()
    job = queue.add("x.mp3")
    time.sleep(0.1)
    queue.cancel(job.id)
    time.sleep(0.2)
    queue.stop()

    assert job.status == JobStatus.CANCELLED.value
    assert slow_calls["n"] < 200, "cancelling did not stop the work"


# -- export -------------------------------------------------------------


@pytest.fixture
def corrected(service, tmp_path):
    return service.transcribe(make_wav(tmp_path / "shiur.wav"))


def test_txt_export_keeps_hebrew(corrected, tmp_path, service):
    categories = {e.id: e.category for e in service.lexicon.all()}
    path = txt_export.write(corrected, tmp_path / "a.txt",
                            OutputMode.HEBREW_SCRIPT, categories=categories)
    text = path.read_text(encoding="utf-8-sig")
    assert "גמרא" in text
    assert path.read_bytes()[:3] == b"\xef\xbb\xbf", "Notepad needs the BOM"


def test_srt_and_vtt_have_the_right_timestamp_punctuation(corrected, tmp_path):
    srt = subtitles.write_srt(corrected, tmp_path / "a.srt",
                              OutputMode.YESHIVISH_ENGLISH).read_text(encoding="utf-8")
    vtt = subtitles.write_vtt(corrected, tmp_path / "a.vtt",
                              OutputMode.YESHIVISH_ENGLISH).read_text(encoding="utf-8")
    assert srt.startswith("1\n")
    assert "-->" in srt and "," in srt.split("-->")[0]
    assert vtt.startswith("WEBVTT")
    assert "." in vtt.split("-->")[1].split("\n")[0]


def test_docx_marks_hebrew_as_complex_script(corrected, tmp_path, service):
    """Without this Word paints Hebrew in the Latin font and it comes out wrong."""
    categories = {e.id: e.category for e in service.lexicon.all()}
    path = docx_export.write(corrected, tmp_path / "a.docx",
                             OutputMode.HEBREW_SCRIPT, categories=categories)
    with zipfile.ZipFile(path) as archive:
        document = archive.read("word/document.xml").decode("utf-8")
    assert "גמרא" in document
    assert "<w:rtl/>" in document


def test_export_reflects_the_mode_it_was_asked_for(corrected, tmp_path, service):
    categories = {e.id: e.category for e in service.lexicon.all()}
    raw = txt_export.write(corrected, tmp_path / "raw.txt", OutputMode.RAW,
                           categories=categories).read_text(encoding="utf-8-sig")
    fixed = txt_export.write(corrected, tmp_path / "fixed.txt",
                             OutputMode.YESHIVISH_ENGLISH,
                             categories=categories).read_text(encoding="utf-8-sig")
    assert "camera" in raw and "Gemara" not in raw
    assert "Gemara" in fixed and "camera" not in fixed


# -- the engine contract ------------------------------------------------


def test_the_faster_whisper_engine_refuses_a_missing_model(tmp_path):
    from app.asr.faster_whisper_engine import FasterWhisperEngine

    engine = FasterWhisperEngine(model_root=tmp_path / "models")
    usable, reason = engine.is_available()
    assert usable and reason

    with pytest.raises(EngineUnavailable) as excinfo:
        engine.transcribe(make_wav(tmp_path / "a.wav"),
                          TranscribeOptions(model_id="whisper-large-v3"))
    assert "Model Vault" in str(excinfo.value), "the error should say what to do"


@pytest.mark.parametrize("device,compute,expected", [
    ("cpu", "auto", ("cpu", "int8")),
    ("cuda", "auto", ("cuda", "float16")),
    ("cpu", "float32", ("cpu", "float32")),
])
def test_precision_is_paired_with_the_device(device, compute, expected):
    """float16 on a processor is slower than int8 and no more accurate."""
    from app.asr.faster_whisper_engine import FasterWhisperEngine

    assert FasterWhisperEngine.resolve_device(device, compute) == expected
