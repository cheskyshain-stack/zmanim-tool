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
