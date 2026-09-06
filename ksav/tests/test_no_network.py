"""The test behind the privacy promise.

Ksav claims that nothing except an explicit model download touches the network.
A claim like that decays the moment someone adds an innocent looking import, so
it is enforced here in two ways rather than trusted:

1. A static scan of every source file. Only ``app/platform/net.py`` may import a
   networking module at all.
2. A runtime check. Sockets are replaced with something that raises, and then a
   full transcription, a settings round trip, a hardware probe and a model
   inventory are all run. Any attempt to dial out fails the test.

If this test starts failing, the fix is to route the code through
``app.platform.net`` and put it behind the gate, not to relax the test.
"""

from __future__ import annotations

import ast
import socket
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"

# Modules that can reach the network. Importing any of them outside the gateway
# means the privacy guarantee is no longer enforceable by reading one file.
NETWORK_MODULES = {
    "socket", "ssl", "http", "urllib", "urllib3", "ftplib", "smtplib",
    "telnetlib", "requests", "httpx", "aiohttp", "websocket", "websockets",
    "xmlrpc", "asyncio.streams", "huggingface_hub", "boto3",
}

# The single permitted exception, and the reason it exists.
GATEWAY = APP / "platform" / "net.py"


def _source_files() -> list[Path]:
    return sorted(p for p in APP.rglob("*.py") if p != GATEWAY)


def _imported_roots(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                roots.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            # A relative import cannot reach a third party network library.
            if node.level == 0 and node.module:
                roots.add(node.module.split(".")[0])
    return roots


def test_only_the_gateway_imports_networking():
    offenders: list[str] = []
    for path in _source_files():
        hits = _imported_roots(path) & NETWORK_MODULES
        if hits:
            offenders.append(f"{path.relative_to(ROOT)} imports {', '.join(sorted(hits))}")
    assert not offenders, (
        "Only app/platform/net.py may import a networking module.\n  "
        + "\n  ".join(offenders)
    )


def test_gateway_is_where_we_think_it_is():
    """Guard against the gateway being renamed and the scan quietly passing."""
    assert GATEWAY.is_file(), "app/platform/net.py is missing, so the scan above proves nothing"
    assert "urllib" in GATEWAY.read_text(encoding="utf-8")


@pytest.fixture
def no_sockets(monkeypatch):
    """Make every outbound connection an immediate, loud failure."""

    class Blocked(socket.socket):
        def __init__(self, *args, **kwargs):
            raise AssertionError("Ksav tried to open a socket during an offline task")

    def blocked_connection(*args, **kwargs):
        raise AssertionError("Ksav tried to open a connection during an offline task")

    monkeypatch.setattr(socket, "socket", Blocked)
    monkeypatch.setattr(socket, "create_connection", blocked_connection)
    monkeypatch.setattr(socket, "getaddrinfo", blocked_connection)
    return True


def test_a_full_transcription_makes_no_connection(no_sockets, tmp_path):
    from app.asr import registry
    from app.asr.base import TranscribeOptions
    from app.asr.demo_engine import register_into

    register_into(registry)
    engine = registry.get("demo")
    transcript = engine.transcribe(tmp_path / "shiur.m4a", TranscribeOptions())
    assert transcript.segments
    assert transcript.text()


def test_settings_and_hardware_make_no_connection(no_sockets, tmp_path):
    from app.core import settings as settings_module
    from app.platform import hardware
    from app.platform.models import CATALOGUE, ModelManager

    path = tmp_path / "settings.json"
    loaded = settings_module.load(path)
    settings_module.save(loaded, path)
    assert settings_module.load(path).transcription.model_id == loaded.transcription.model_id

    hw = hardware.detect()
    assert hardware.recommend(hw).asr_model

    manager = ModelManager(tmp_path / "models")
    for spec in CATALOGUE:
        assert manager.state(spec).installed is False


def test_the_gate_is_closed_by_default():
    from app.platform import net

    assert not net.gate.open
    with pytest.raises(net.NetworkBlocked):
        net.download("https://example.invalid/model.bin", "/tmp/should-never-exist")


def test_the_gate_closes_even_when_a_download_fails():
    from app.platform import net

    with pytest.raises(ValueError):
        with net.gate("deliberate failure"):
            raise ValueError("simulated download error")
    assert not net.gate.open, "the gate must not be left open by an exception"


def test_offline_environment_pins_are_set(monkeypatch):
    """Inference libraries must not be able to fetch a missing file on their own."""
    from app.platform import net

    for name in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY"):
        monkeypatch.delenv(name, raising=False)
    net.enforce_offline_env()

    import os

    assert os.environ["HF_HUB_OFFLINE"] == "1"
    assert os.environ["TRANSFORMERS_OFFLINE"] == "1"
    assert os.environ["HF_HUB_DISABLE_TELEMETRY"] == "1"


def test_nothing_opens_a_browser():
    """Ksav is a native window, not a web page, online or offline.

    A stray openUrl would send the user into a browser, which is exactly what
    they asked to avoid, and on an offline machine it would fail confusingly.
    """
    browser_calls = ("webbrowser", "QDesktopServices", "openUrl", "QWebEngineView")
    offenders = []
    for path in APP.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        hits = [call for call in browser_calls if call in text]
        if hits:
            offenders.append(f"{path.relative_to(ROOT)} mentions {', '.join(hits)}")
    assert not offenders, "Ksav must never open a browser:\n  " + "\n  ".join(offenders)
