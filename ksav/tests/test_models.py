"""The Model Vault's bookkeeping, all of it offline."""

from __future__ import annotations

import pytest

from app.platform.models import BY_ID, CATALOGUE, ModelManager


def test_the_catalogue_is_coherent():
    ids = [s.id for s in CATALOGUE]
    assert len(ids) == len(set(ids)), "duplicate model id"
    for spec in CATALOGUE:
        assert spec.files, f"{spec.id} lists no files"
        assert spec.size_bytes > 0
        assert spec.licence, f"{spec.id} has no licence recorded"
        assert spec.notes, f"{spec.id} has no explanation for the user"
        required = [f for f in spec.files if not f.optional]
        if spec.kind == "asr":
            assert any(f.name == "model.bin" for f in required), \
                f"{spec.id} has no weights file"
        elif spec.kind == "ocr":
            assert any(f.name.endswith(".traineddata") for f in required), \
                f"{spec.id} has no language data"


def test_every_licence_is_one_we_can_distribute():
    """The user may distribute Ksav later, so no copyleft or revenue capped weights."""
    permissive = {"MIT", "Apache-2.0", "BSD-3-Clause"}
    for spec in CATALOGUE:
        assert spec.licence in permissive, f"{spec.id} carries {spec.licence}"


def test_speech_and_page_reading_are_both_catalogued():
    from app.platform.models import asr_models, ocr_models

    assert len(asr_models()) >= 4
    assert {s.id for s in ocr_models()} >= {"ocr-heb", "ocr-eng"}
    assert all(s.kind == "ocr" for s in ocr_models())


def test_installed_language_packs_are_gathered_into_one_folder(tmp_path, monkeypatch):
    """Tesseract wants all its language data in one directory.

    The vendored folder is pointed somewhere empty for this test. On a build
    machine it holds the language data that ships with Ksav, which
    tessdata_dir merges in by design, and this test is about the manager's own
    behaviour rather than that.
    """
    from app.core import paths
    from app.platform.models import BY_ID, ModelManager

    monkeypatch.setattr(paths, "VENDOR_DIR", tmp_path / "no-vendor")
    manager = ModelManager(tmp_path / "models")
    for model_id in ("ocr-heb", "ocr-eng"):
        spec = BY_ID[model_id]
        source = tmp_path / "usb" / model_id
        source.mkdir(parents=True)
        for f in spec.files:
            (source / f.name).write_bytes(b"trained")
        manager.import_from_folder(spec, source)

    tessdata = manager.tessdata_dir()
    assert {p.name for p in tessdata.glob("*.traineddata")} == {
        "heb.traineddata", "eng.traineddata"
    }
    assert manager.installed_ocr_languages() == {"heb", "eng"}

    manager.remove(BY_ID["ocr-eng"])
    assert {p.name for p in manager.tessdata_dir().glob("*.traineddata")} == {
        "heb.traineddata"
    }


def test_language_data_shipped_with_ksav_is_not_hidden_by_an_install(tmp_path, monkeypatch):
    """Installing one pack must not lose the ones that came with the program.

    tessdata_dir builds a single folder for Tesseract, and an early version
    built it from installed packs alone, so installing Yiddish would have
    hidden the Hebrew that shipped in the box.
    """
    from app.core import paths
    from app.platform.models import BY_ID, ModelManager

    vendor = tmp_path / "vendor"
    shipped = vendor / "tesseract" / "tessdata"
    shipped.mkdir(parents=True)
    (shipped / "heb.traineddata").write_bytes(b"shipped")
    (shipped / "osd.traineddata").write_bytes(b"shipped")
    monkeypatch.setattr(paths, "VENDOR_DIR", vendor)

    manager = ModelManager(tmp_path / "models")
    spec = BY_ID["ocr-yid"]
    source = tmp_path / "usb" / spec.id
    source.mkdir(parents=True)
    for f in spec.files:
        (source / f.name).write_bytes(b"downloaded")
    manager.import_from_folder(spec, source)

    names = {p.name for p in manager.tessdata_dir().glob("*.traineddata")}
    assert names == {"heb.traineddata", "osd.traineddata", "yid.traineddata"}


def test_nothing_is_installed_on_a_fresh_machine(tmp_path):
    manager = ModelManager(tmp_path)
    assert manager.installed_ids() == []
    assert manager.total_bytes_on_disk() == 0
    for spec in CATALOGUE:
        state = manager.state(spec)
        assert not state.installed
        assert state.missing


def test_path_for_returns_nothing_until_a_model_is_complete(tmp_path):
    manager = ModelManager(tmp_path)
    spec = BY_ID["whisper-small"]
    assert manager.path_for(spec.id) is None

    directory = manager.directory(spec)
    directory.mkdir(parents=True)
    (directory / "config.json").write_text("{}", encoding="utf-8")
    assert manager.path_for(spec.id) is None, "a partial folder must not look installed"


def test_import_from_a_folder_needs_no_network(tmp_path):
    manager = ModelManager(tmp_path / "models")
    spec = BY_ID["whisper-small"]

    stick = tmp_path / "usb"
    stick.mkdir()
    for f in spec.files:
        if not f.optional:
            (stick / f.name).write_bytes(b"weights")

    manager.import_from_folder(spec, stick)
    assert manager.is_installed(spec.id)
    assert manager.path_for(spec.id) == manager.directory(spec)
    assert manager.total_bytes_on_disk() > 0


def test_an_incomplete_folder_is_refused_with_a_useful_message(tmp_path):
    manager = ModelManager(tmp_path / "models")
    spec = BY_ID["whisper-medium"]
    stick = tmp_path / "usb"
    stick.mkdir()
    (stick / "config.json").write_text("{}", encoding="utf-8")

    with pytest.raises(FileNotFoundError) as excinfo:
        manager.import_from_folder(spec, stick)
    assert "model.bin" in str(excinfo.value)
    assert not manager.is_installed(spec.id), "a refused import must leave nothing behind"


def test_removing_a_model_frees_the_space(tmp_path):
    manager = ModelManager(tmp_path / "models")
    spec = BY_ID["whisper-small"]
    stick = tmp_path / "usb"
    stick.mkdir()
    for f in spec.files:
        if not f.optional:
            (stick / f.name).write_bytes(b"weights")
    manager.import_from_folder(spec, stick)

    manager.remove(spec)
    assert not manager.is_installed(spec.id)
    assert manager.total_bytes_on_disk() == 0
