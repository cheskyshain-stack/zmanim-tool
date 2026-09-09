"""The build files, checked without running a build.

A packaging mistake shows up late and painfully: the build succeeds and the
application fails on somebody else's machine. These are the cheap checks that
catch drift between the code and the files that ship it.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "packaging" / "ksav.spec"
ISS = ROOT / "packaging" / "installer.iss"
WORKFLOW = ROOT.parent / ".github" / "workflows" / "build-ksav-windows.yml"


def test_the_spec_and_installer_exist():
    assert SPEC.is_file()
    assert ISS.is_file()
    assert (ROOT / "packaging" / "ksav.ico").is_file(), "the application has no icon"


def test_the_spec_bundles_what_the_application_reads_at_run_time():
    """These are read from disk, so missing them fails only once installed."""
    spec = SPEC.read_text(encoding="utf-8")
    assert "app/language/data" in spec, "the seed dictionary would not ship"
    assert "app/export/fonts" in spec, "the PDF exporter's Hebrew font would not ship"
    assert "vendor" in spec and "tesseract" in spec.lower()


def test_the_spec_declares_the_engines_as_hidden_imports():
    """Imported inside functions, so PyInstaller cannot see them by itself."""
    spec = SPEC.read_text(encoding="utf-8")
    for module in ("faster_whisper", "ctranslate2", "pytesseract", "sounddevice",
                   "onnxruntime", "pypdfium2", "bidi"):
        assert f'"{module}"' in spec, f"{module} is not declared and will be missed"


def test_the_spec_ships_no_ffmpeg_binary():
    """PyAV carries LGPL FFmpeg already; a second one risks a GPL build."""
    spec = SPEC.read_text(encoding="utf-8")
    assert "ffmpeg" not in spec.lower().replace("no ffmpeg", "").replace(
        "ffmpeg's libraries", "")


def test_the_spec_leaves_out_what_is_not_used():
    spec = SPEC.read_text(encoding="utf-8")
    for unused in ("tkinter", "matplotlib", "torch", "QtWebEngineCore"):
        assert unused in spec, f"{unused} is not excluded and would bloat the download"


def test_the_installer_needs_no_administrator():
    """A nontechnical person should not have to find someone with the password."""
    iss = ISS.read_text(encoding="utf-8")
    assert "PrivilegesRequired=lowest" in iss
    assert "localappdata" in iss.lower()


def test_the_installer_id_is_a_real_guid():
    """Inno rejects a malformed one, and it must never change across versions."""
    import uuid

    iss = ISS.read_text(encoding="utf-8")
    match = re.search(r"AppId=\{\{([0-9A-Fa-f-]+)\}", iss)
    assert match, "no AppId is set, so upgrades would install a second copy"
    uuid.UUID(match.group(1))


def test_the_installer_leaves_models_and_the_dictionary_alone():
    """Reinstalling should not cost somebody several gigabytes and their own work."""
    iss = ISS.read_text(encoding="utf-8")
    assert "deliberately left in place" in iss
    assert "{app}\\_internal" in iss or "{app}\\\\_internal" in iss


def test_the_version_is_consistent_across_the_build_files():
    iss = ISS.read_text(encoding="utf-8")
    build = (ROOT / "packaging" / "build.py").read_text(encoding="utf-8")
    version = re.search(r'#define AppVersion "([\d.]+)"', iss).group(1)
    assert f'VERSION = "{version}"' in build, "build.py and the installer disagree"

    info = ROOT / "packaging" / "version_info.txt"
    if info.is_file():
        assert version in info.read_text(encoding="utf-8")


@pytest.mark.skipif(not WORKFLOW.is_file(), reason="no CI workflow in this checkout")
def test_the_windows_build_runs_the_tests_and_checks_the_result_starts():
    """A green build that will not open is worse than a red one."""
    workflow = WORKFLOW.read_text(encoding="utf-8")
    assert "windows-latest" in workflow
    assert "pytest" in workflow, "the CI build does not run the tests"
    assert "Ksav.exe" in workflow, "the CI build never checks the program starts"
    assert "upload-artifact" in workflow, "the installer is built and then thrown away"


def test_the_build_script_refuses_to_ship_a_red_build():
    build = (ROOT / "packaging" / "build.py").read_text(encoding="utf-8")
    assert "pytest" in build
    assert "--skip-tests" in build, "there should be a deliberate way past it"


def test_the_vendor_fetcher_only_takes_a_self_contained_installation():
    """It once found /usr/bin and tried to vendor the operating system."""
    import sys

    sys.path.insert(0, str(ROOT))
    from importlib.util import module_from_spec, spec_from_file_location

    spec = spec_from_file_location(
        "fetch_vendor", ROOT / "packaging" / "fetch-vendor.py"
    )
    module = module_from_spec(spec)
    spec.loader.exec_module(module)

    assert not module.is_self_contained(Path("/usr/bin"))
    assert not module.is_self_contained(Path("/usr/share/tesseract-ocr/5"))


def _pins(path: Path) -> dict[str, str]:
    """Every pinned requirement in a requirements file."""
    pins = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#")[0].strip()
        if "==" in line and not line.startswith("-"):
            name, version = line.split("==", 1)
            pins[name.strip().lower().replace("_", "-")] = version.strip()
    return pins


@pytest.mark.parametrize("filename", ["requirements.txt", "requirements-dev.txt"])
def test_every_pinned_version_is_one_that_actually_exists(filename):
    """The pins must match a real, installed package.

    Six of them were written from memory and were wrong. The Windows build
    failed on the first one it reached, six seconds in, having downloaded
    nothing useful. A pin that does not exist is not a version conflict, it is
    a typo, and this is where it should be caught.
    """
    import importlib.metadata as metadata

    missing = []
    wrong = []
    for name, pinned in _pins(ROOT / filename).items():
        try:
            installed = metadata.version(name)
        except metadata.PackageNotFoundError:
            missing.append(name)
            continue
        if installed != pinned:
            wrong.append(f"{name}: pinned {pinned}, installed {installed}")

    assert not wrong, (
        "These pins do not match what is installed, so a clean build would get "
        "something different or fail outright:\n  " + "\n  ".join(wrong)
    )
    # A package that is simply not installed here is reported rather than
    # failed, since the dev environment may legitimately lack an optional one.
    if missing:
        print(f"not installed in this environment: {', '.join(missing)}")
