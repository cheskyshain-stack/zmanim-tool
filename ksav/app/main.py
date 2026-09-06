"""Ksav entry point.

Order matters here. The offline pins go in before any inference library has a
chance to be imported, and the hardware probe runs before the window so the
first thing the user sees already knows what machine it is on.
"""

from __future__ import annotations

import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import logging as klogging
from app.core import paths, settings as settings_module
from app.platform import hardware as hardware_module
from app.platform import net
from app.platform.models import ModelManager


def build_application():
    from PySide6.QtGui import QIcon
    from PySide6.QtWidgets import QApplication

    app = QApplication.instance() or QApplication(sys.argv)
    app.setApplicationName("Ksav")
    app.setOrganizationName("Ksav")
    app.setApplicationDisplayName("Ksav")
    return app


def build_services(settings):
    """The dictionary, the recognition engines, and the background queue.

    Engines register here rather than at import, so that nothing heavy is
    pulled in until the application actually starts.
    """
    from app.asr import registry as asr_registry
    from app.asr.demo_engine import register_into as register_demo
    from app.asr.faster_whisper_engine import register_into as register_whisper
    from app.language.lexicon import Lexicon
    from app.services.job_queue import JobQueue
    from app.services.transcription import TranscriptionService

    register_whisper(asr_registry)
    register_demo(asr_registry)

    lexicon = Lexicon(paths.lexicon_db())
    seed = paths.bundle_root() / "app" / "language" / "data" / "seed_lexicon.jsonl"
    if seed.is_file():
        added = lexicon.seed_from(seed)
        if added:
            klogging.get("ksav").info("seeded %d dictionary terms", added)

    service = TranscriptionService(settings, lexicon)
    queue = JobQueue(service.make_runner())
    queue.restore()
    queue.start()
    return lexicon, queue, service


def build_window(settings, hardware, recommendation, manager,
                 lexicon=None, queue=None, service=None):
    from PySide6.QtWidgets import QMainWindow

    from app.ui.shell import Shell

    window = QMainWindow()
    window.setWindowTitle("Ksav")
    window.resize(settings.ui.window_width, settings.ui.window_height)
    window.setMinimumSize(940, 620)

    shell = Shell(settings, hardware, recommendation, manager,
                  lexicon=lexicon, queue=queue, service=service)
    window.setCentralWidget(shell)
    shell.apply_theme()

    original_close = window.closeEvent

    def on_close(event):
        shell.persist()
        if queue is not None:
            # Journalled work resumes next launch; this just stops the worker.
            queue.stop()
        original_close(event)

    window.closeEvent = on_close
    return window, shell


def main() -> int:
    # Before anything else: pin the inference libraries offline so none of them
    # can quietly fetch a missing file, and create the data folders.
    net.enforce_offline_env()
    paths.ensure_dirs()
    klogging.configure()
    log = klogging.get("ksav")

    settings = settings_module.load()
    hardware = hardware_module.detect()
    recommendation = hardware_module.recommend(hardware)
    log.info("hardware: %s", hardware.summary())
    log.info("recommended: %s on %s", recommendation.asr_model, recommendation.device)

    manager = ModelManager()
    lexicon, queue, service = build_services(settings)

    app = build_application()
    window, _shell = build_window(
        settings, hardware, recommendation, manager,
        lexicon=lexicon, queue=queue, service=service,
    )
    window.show()
    try:
        return app.exec()
    finally:
        queue.stop()
        lexicon.close()


if __name__ == "__main__":
    raise SystemExit(main())
