"""The USB story, end to end, with the network unplugged.

The scenario these tests protect: someone downloads a bundle on a computer that
has internet, copies it to a stick, walks it to a computer that has none, and
gets a working Ksav without opening a browser, a command prompt, or a file
dialog.
"""

from __future__ import annotations

import os
import socket

import pytest

from app.core import paths
from app.platform import media
from app.platform.models import BY_ID, CATALOGUE, ModelManager


@pytest.fixture
def stick(tmp_path, monkeypatch):
    """A pretend USB stick that the program believes it is sitting on."""
    drive = tmp_path / "USB"
    drive.mkdir()
    monkeypatch.delenv("KSAV_DATA_DIR", raising=False)
    monkeypatch.setattr(paths, "app_dir", lambda: drive)
    return drive


def fill(spec, folder):
    folder.mkdir(parents=True, exist_ok=True)
    for f in spec.files:
        if not f.optional:
            (folder / f.name).write_bytes(b"weights")
    return folder


# -- portable mode ------------------------------------------------------


def test_without_the_marker_ksav_uses_the_computer(stick):
    assert not paths.is_portable()
    assert "KsavData" not in str(paths.data_root())


def test_the_marker_moves_everything_onto_the_stick(stick):
    (stick / paths.PORTABLE_MARKER).write_text("portable", encoding="utf-8")

    assert paths.is_portable()
    root = paths.data_root()
    assert root == stick / "KsavData"
    for path in (paths.models_dir(), paths.settings_file(), paths.lexicon_db()):
        assert str(path).startswith(str(root)), f"{path} escaped the stick"


def test_a_write_protected_stick_falls_back_instead_of_failing(stick, monkeypatch):
    """A read only drive should slow Ksav down, not stop it opening."""
    (stick / paths.PORTABLE_MARKER).write_text("portable", encoding="utf-8")
    monkeypatch.setattr(paths, "_is_writable", lambda directory: False)

    assert not paths.is_portable()
    assert paths.portable_requested_but_unavailable(), "the user should be told why"
    assert paths.data_root() != stick / "KsavData"


def test_the_location_is_described_in_plain_words(stick):
    assert "On this computer" in paths.describe_location()
    (stick / paths.PORTABLE_MARKER).write_text("portable", encoding="utf-8")
    assert "Portable" in paths.describe_location()


def test_the_model_manager_follows_the_stick(stick, monkeypatch):
    (stick / paths.PORTABLE_MARKER).write_text("portable", encoding="utf-8")
    assert str(ModelManager().root).startswith(str(stick))


# -- finding what was copied across -------------------------------------


def test_a_model_in_the_bundle_layout_is_found(stick, tmp_path):
    spec = BY_ID["whisper-medium"]
    fill(spec, stick / "Models" / spec.id)

    manager = ModelManager(tmp_path / "installed")
    found = manager.discover(spec)
    assert found and found[0] == stick / "Models" / spec.id


def test_a_model_dropped_beside_the_program_is_found(stick, tmp_path):
    spec = BY_ID["whisper-small"]
    fill(spec, stick / spec.id)

    manager = ModelManager(tmp_path / "installed")
    assert manager.discover(spec)


def test_an_incomplete_folder_is_not_offered(stick, tmp_path):
    spec = BY_ID["whisper-medium"]
    folder = stick / "Models" / spec.id
    folder.mkdir(parents=True)
    (folder / "config.json").write_text("{}", encoding="utf-8")

    manager = ModelManager(tmp_path / "installed")
    assert manager.discover(spec) == [], "a half copied model must not look ready"


def test_discover_all_skips_what_is_already_installed(stick, tmp_path):
    small, medium = BY_ID["whisper-small"], BY_ID["whisper-medium"]
    fill(small, stick / "Models" / small.id)
    fill(medium, stick / "Models" / medium.id)

    manager = ModelManager(tmp_path / "installed")
    assert set(manager.discover_all()) == {small.id, medium.id}

    manager.import_from_folder(small, stick / "Models" / small.id)
    assert set(manager.discover_all()) == {medium.id}


def test_installing_from_a_stick_opens_no_socket(stick, tmp_path, monkeypatch):
    """The whole point: the offline computer never touches the network."""

    def blocked(*args, **kwargs):
        raise AssertionError("installing from a USB stick tried to use the network")

    monkeypatch.setattr(socket, "socket", blocked)
    monkeypatch.setattr(socket, "create_connection", blocked)
    monkeypatch.setattr(socket, "getaddrinfo", blocked)

    spec = BY_ID["whisper-medium"]
    fill(spec, stick / "Models" / spec.id)

    manager = ModelManager(tmp_path / "installed")
    found = manager.discover(spec)
    manager.import_from_folder(spec, found[0])

    assert manager.is_installed(spec.id)
    assert manager.path_for(spec.id) is not None


def test_removable_drive_scan_is_harmless_off_windows():
    assert media.removable_drives() == [] or os.name == "nt"


# -- the bundle builder --------------------------------------------------


def test_the_bundle_builder_writes_the_layout_it_documents(tmp_path, monkeypatch):
    """Built without downloading, by faking the transfer of each file."""
    from app.platform import net

    def fake_download(url, destination, **kwargs):
        from pathlib import Path

        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"weights")
        return destination

    monkeypatch.setattr(net, "download", fake_download)

    spec = BY_ID["whisper-small"]
    bundle = tmp_path / "KsavUSB"
    manager = ModelManager(bundle / "Models")
    manager.download_to(spec, bundle / "Models" / spec.id)

    assert manager.looks_like(spec, bundle / "Models" / spec.id)
    assert (bundle / "Models" / spec.id / ModelManager.MANIFEST).is_file()

    # And a fresh install on the offline machine picks it straight up.
    monkeypatch.delenv("KSAV_DATA_DIR", raising=False)
    monkeypatch.setattr(paths, "app_dir", lambda: bundle)
    offline = ModelManager(tmp_path / "offline")
    assert offline.discover(spec), "the built bundle is not in a layout Ksav recognises"


def test_download_to_still_respects_the_network_gate(tmp_path):
    """The builder is allowed online. It must still go through the one gateway."""
    from app.platform import net

    assert not net.gate.open
    spec = BY_ID["whisper-small"]
    manager = ModelManager(tmp_path)
    with pytest.raises(Exception):
        # No monkeypatch here, so the real download runs and fails on a bad host
        # rather than silently succeeding outside the gate.
        manager.download_to(spec, tmp_path / "out", should_cancel=lambda: True)
    assert not net.gate.open, "the gate must close even when a build is cancelled"


def test_every_catalogue_model_can_be_bundled():
    """A model the builder cannot describe is a model a user cannot carry."""
    for spec in CATALOGUE:
        assert spec.size_label
        assert [f for f in spec.files if not f.optional]


def test_portable_mode_writes_nothing_to_the_host_computer(stick, monkeypatch):
    """The claim on the box: a borrowed computer is left exactly as it was found.

    This caught a real leak. Module level path constants were resolved at import,
    so logs and settings still went to %LOCALAPPDATA% while models moved to the
    stick. Every path must be resolved through a function.
    """
    (stick / paths.PORTABLE_MARKER).write_text("portable", encoding="utf-8")
    root = str(paths.data_root())

    for name, path in [
        ("settings", paths.settings_file()),
        ("dictionary", paths.lexicon_db()),
        ("models", paths.models_dir()),
        ("jobs", paths.jobs_dir()),
        ("logs", paths.logs_dir()),
        ("cache", paths.cache_dir()),
    ]:
        assert str(path).startswith(root), f"{name} would be written to the host computer"


def test_no_module_level_path_constants_remain():
    """The trap that caused the leak above must not come back."""
    for name in ("DATA_ROOT", "SETTINGS_FILE", "MODELS_DIR", "LOGS_DIR",
                 "LEXICON_DB", "JOBS_DIR", "CACHE_DIR"):
        assert not hasattr(paths, name), (
            f"paths.{name} is resolved at import and cannot follow a portable stick"
        )
