"""Interface tests, run headless.

These are deliberately not screenshot comparisons. They check the things that
actually broke during development: whether a screen is squeezed until its labels
vanish, whether the readiness wording matches what is really installed, and
whether every navigation entry leads somewhere.
"""

from __future__ import annotations

import os

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

pytest.importorskip("PySide6")

from PySide6.QtWidgets import QApplication      # noqa: E402

from app.core.settings import Settings          # noqa: E402
from app.platform.hardware import Gpu, Hardware, recommend    # noqa: E402
from app.platform.models import BY_ID, ModelManager           # noqa: E402
from app.ui.shell import NAV, Shell             # noqa: E402
from app.ui.widgets import StatusPill           # noqa: E402


@pytest.fixture(scope="module")
def qt_app():
    app = QApplication.instance() or QApplication([])
    yield app


@pytest.fixture
def machine():
    hw = Hardware(cpu_name="Test CPU", physical_cores=8, logical_cores=16, ram_gb=32.0)
    hw.gpus = [Gpu("RTX 3060", "nvidia", 12 * 1024)]
    hw.cuda_available = True
    return hw


def build(qt_app, tmp_path, machine, settings=None):
    settings = settings or Settings()
    manager = ModelManager(tmp_path / "models")
    shell = Shell(settings, machine, recommend(machine), manager)
    shell.resize(1180, 800)
    qt_app.processEvents()
    return shell, manager, settings


def install(manager, model_id):
    spec = BY_ID[model_id]
    directory = manager.directory(spec)
    directory.mkdir(parents=True, exist_ok=True)
    for f in spec.files:
        if not f.optional:
            (directory / f.name).write_bytes(b"weights")
    manager._write_manifest(spec)


def test_every_navigation_entry_leads_to_a_screen(qt_app, tmp_path, machine):
    shell, _, _ = build(qt_app, tmp_path, machine)
    for key, _label in NAV:
        shell.show_section(key)
        qt_app.processEvents()
        assert shell.stack.currentWidget() is shell._screens[key], f"{key} went nowhere"


def test_the_pill_says_a_model_is_needed_when_none_is_installed(qt_app, tmp_path, machine):
    shell, _, _ = build(qt_app, tmp_path, machine)
    assert shell.pill.property("state") == StatusPill.DANGER
    assert "OFFLINE" in shell.pill.text(), "it must never stop saying offline"
    assert "Model needed" in shell.pill.text()


def test_the_pill_goes_green_once_the_chosen_model_is_present(qt_app, tmp_path, machine):
    shell, manager, settings = build(qt_app, tmp_path, machine)
    install(manager, settings.transcription.model_id)
    shell._evaluate_readiness()

    assert shell.pill.property("state") == StatusPill.OK
    assert shell.pill.text() == "OFFLINE · Processing locally"
    assert "ready" in shell.home.readiness_text.text().lower()


def test_a_different_installed_model_is_a_warning_not_a_failure(qt_app, tmp_path, machine):
    settings = Settings()
    settings.transcription.model_id = "whisper-large-v3"
    shell, manager, _ = build(qt_app, tmp_path, machine, settings)

    install(manager, "whisper-small")
    shell._evaluate_readiness()

    assert shell.pill.property("state") == StatusPill.WARN
    assert "Whisper small" in shell.home.readiness_text.text(), (
        "the user should be told what they do have, not only what they lack"
    )


def test_no_wording_anywhere_claims_the_app_is_online(qt_app, tmp_path, machine):
    shell, manager, settings = build(qt_app, tmp_path, machine)
    seen = []
    for _ in range(2):
        seen.append(shell.pill.text())
        install(manager, settings.transcription.model_id)
        shell._evaluate_readiness()
    seen.append(shell.pill.text())
    for text in seen:
        assert text.startswith("OFFLINE")


def test_the_vault_lists_every_model_and_none_is_squeezed_away(qt_app, tmp_path, machine):
    """The bug this catches: rows compressed until the model name stopped drawing."""
    shell, _, _ = build(qt_app, tmp_path, machine)
    shell.show_section("vault")
    qt_app.processEvents()

    rows = shell.vault._rows
    assert len(rows) == 5
    for row in rows:
        assert row.sizeHint().height() >= 120, "a row must have room for its own content"
        assert row.action_button.sizeHint().width() >= row.action_button.fontMetrics().horizontalAdvance(
            row.action_button.text()
        ), "the button is narrower than its own label"


def test_the_three_home_actions_navigate(qt_app, tmp_path, machine):
    shell, _, _ = build(qt_app, tmp_path, machine)
    for target in ("transcribe", "dictation", "ocr"):
        shell.home.navigate.emit(target)
        qt_app.processEvents()
        assert shell.stack.currentWidget() is shell._screens[target]


def test_settings_writes_through_to_disk(qt_app, tmp_path, machine, monkeypatch):
    from app.core import paths

    monkeypatch.setattr(paths, "settings_file", lambda: tmp_path / "settings.json")
    shell, _, settings = build(qt_app, tmp_path, machine)

    view = shell.settings_view
    view.mode_box.setCurrentIndex(1)          # Hebrew script
    qt_app.processEvents()

    from app.core.settings import load

    assert load(tmp_path / "settings.json").language.output_mode == settings.language.output_mode


def test_both_themes_define_every_colour():
    """A colour defined in only one theme is the classic unreadable interface bug."""
    from dataclasses import fields

    from app.ui.palette import DARK, LIGHT, stylesheet

    for f in fields(LIGHT):
        if f.name == "name":
            continue
        assert getattr(LIGHT, f.name).startswith("#"), f"{f.name} missing in light"
        assert getattr(DARK, f.name).startswith("#"), f"{f.name} missing in dark"
    assert len(stylesheet(LIGHT)) == len(stylesheet(DARK)), "the themes have drifted apart"


# ---------------------------------------------------------------------------
# Phase 1 screens
# ---------------------------------------------------------------------------


import math          # noqa: E402
import struct        # noqa: E402
import time          # noqa: E402
import wave          # noqa: E402
from pathlib import Path   # noqa: E402

from app.asr import registry as asr_registry            # noqa: E402
from app.asr.demo_engine import register_into           # noqa: E402
from app.core.models import OutputMode                  # noqa: E402
from app.language.lexicon import Lexicon                # noqa: E402
from app.services.job_queue import JobQueue             # noqa: E402
from app.services.transcription import (                # noqa: E402
    TranscriptionService,
    TranscriptStore,
)

SEED_PATH = "app/language/data/seed_lexicon.jsonl"


def _wav(path: Path, seconds: float = 2.0) -> Path:
    with wave.open(str(path), "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16000)
        handle.writeframes(b"".join(
            struct.pack("<h", int(2500 * math.sin(2 * math.pi * 200 * i / 16000)))
            for i in range(int(16000 * seconds))
        ))
    return path


@pytest.fixture
def full_shell(qt_app, tmp_path, machine):
    """The whole application, with the demo engine standing in for a model."""
    asr_registry.reset()
    register_into(asr_registry)

    settings = Settings()
    settings.transcription.engine_id = "demo"
    lexicon = Lexicon(tmp_path / "lex.sqlite")
    lexicon.seed_from(SEED_PATH)
    service = TranscriptionService(settings, lexicon, TranscriptStore(tmp_path / "t"))
    queue = JobQueue(service.make_runner(), tmp_path / "jobs")
    queue.start()

    manager = ModelManager(tmp_path / "models")
    shell = Shell(settings, machine, recommend(machine), manager,
                  lexicon=lexicon, queue=queue, service=service)
    shell.resize(1240, 820)
    qt_app.processEvents()

    yield shell, queue, service, lexicon, tmp_path

    queue.stop()
    lexicon.close()
    asr_registry.reset()


def _run_one(qt_app, shell, queue, tmp_path, name="Shiur.wav"):
    shell.show_section("transcribe")
    qt_app.processEvents()
    assert shell.transcribe.add_paths([_wav(tmp_path / name)]) == 1
    for _ in range(80):
        qt_app.processEvents()
        time.sleep(0.03)
        if queue.jobs() and not queue.jobs()[0].is_active:
            break
    return queue.jobs()[0]


def test_dropping_a_recording_queues_and_finishes_it(full_shell, qt_app):
    shell, queue, _service, _lexicon, tmp_path = full_shell
    job = _run_one(qt_app, shell, queue, tmp_path)
    assert job.status == "done"
    shell.transcribe.refresh()
    qt_app.processEvents()
    assert job.id in shell.transcribe._rows


def test_a_file_it_cannot_read_is_refused_before_queueing(full_shell, qt_app, monkeypatch):
    shell, queue, _service, _lexicon, tmp_path = full_shell
    from PySide6.QtWidgets import QMessageBox

    monkeypatch.setattr(QMessageBox, "warning", lambda *a, **k: None)
    monkeypatch.setattr(QMessageBox, "information", lambda *a, **k: None)

    junk = tmp_path / "broken.mp3"
    junk.write_bytes(b"not audio")
    assert shell.transcribe.add_paths([junk]) == 0
    assert not queue.jobs(), "a file that cannot be read should never reach the queue"


def test_opening_a_finished_job_shows_the_transcript(full_shell, qt_app):
    shell, queue, _service, _lexicon, tmp_path = full_shell
    job = _run_one(qt_app, shell, queue, tmp_path)
    shell.open_transcript(job.result_path)
    qt_app.processEvents()

    assert shell.stack.currentWidget() is shell.transcript
    assert "Shiur" in shell.transcript.title.text()
    assert shell.transcript.editor.toPlainText().strip()


def test_all_four_modes_render_from_one_stored_transcript(full_shell, qt_app):
    shell, queue, _service, _lexicon, tmp_path = full_shell
    job = _run_one(qt_app, shell, queue, tmp_path)
    shell.open_transcript(job.result_path)
    qt_app.processEvents()

    view = shell.transcript
    rendered = {}
    for index, mode in enumerate(OutputMode):
        view.mode_box.setCurrentIndex(index)
        qt_app.processEvents()
        rendered[mode] = view.editor.toPlainText()

    assert "Gemara" in rendered[OutputMode.YESHIVISH_ENGLISH]
    assert "גמרא" in rendered[OutputMode.HEBREW_SCRIPT]
    assert "camera" in rendered[OutputMode.RAW]
    assert "Gemara" not in rendered[OutputMode.RAW], "Mode D must be untouched"


def test_undoing_a_correction_in_the_panel_changes_the_text(full_shell, qt_app):
    shell, queue, _service, _lexicon, tmp_path = full_shell
    job = _run_one(qt_app, shell, queue, tmp_path)
    shell.open_transcript(job.result_path)
    view = shell.transcript
    view.mode_box.setCurrentIndex(0)
    qt_app.processEvents()

    row = view._corrections_layout.itemAt(0).widget()
    assert row is not None, "the corrections panel is empty"
    before = view.editor.toPlainText()
    row._toggle()
    qt_app.processEvents()
    after = view.editor.toPlainText()

    assert before != after
    assert row.correction.raw in after, "undo should restore the engine's own word"


def test_clicking_a_paragraph_knows_its_time(full_shell, qt_app):
    shell, queue, _service, _lexicon, tmp_path = full_shell
    job = _run_one(qt_app, shell, queue, tmp_path)
    shell.open_transcript(job.result_path)
    qt_app.processEvents()

    view = shell.transcript
    assert view._block_times, "no paragraph carries a time"
    assert min(view._block_times.values()) == 0.0
    view._on_cursor()
    assert "starts at" in view.hint.text()


def test_exporting_writes_every_format(full_shell, qt_app, tmp_path):
    shell, queue, _service, _lexicon, _tmp = full_shell
    job = _run_one(qt_app, shell, queue, _tmp)
    shell.open_transcript(job.result_path)
    qt_app.processEvents()

    for extension in ("txt", "docx", "srt", "vtt"):
        path = shell.transcript.export_to(_tmp / f"out.{extension}")
        assert path.is_file() and path.stat().st_size > 0, extension


def test_the_dictionary_screen_lists_and_searches(full_shell, qt_app):
    shell, _queue, _service, lexicon, _tmp = full_shell
    shell.show_section("dictionary")
    qt_app.processEvents()

    view = shell.dictionary
    assert view.table.rowCount() > 0
    assert str(lexicon.count()) in view.summary.text()

    view.search.setText("gemara")
    view.refresh()
    qt_app.processEvents()
    assert view.table.rowCount() == 1
    assert view.table.item(0, 0).text() == "Gemara"


def test_editing_the_dictionary_rebuilds_the_matcher(full_shell, qt_app):
    """A term added now must be corrected on the next transcript, not the next launch."""
    shell, _queue, service, lexicon, _tmp = full_shell
    first = service.index
    shell._on_dictionary_changed()
    assert service.index is not first, "the index was not rebuilt after an edit"


def test_the_transcript_screen_is_never_the_startup_screen(qt_app, tmp_path, machine):
    """It has no nav entry, so opening into it would strand the user."""
    settings = Settings()
    settings.ui.last_section = "transcript"
    shell = Shell(settings, machine, recommend(machine), ModelManager(tmp_path / "m"))
    qt_app.processEvents()
    assert shell.stack.currentWidget() is shell.home
