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
    from app.ocr import registry as ocr_registry
    from app.ocr.tesseract_engine import register_into as register_tesseract
    from app.services.job_queue import JobQueue
    from app.services.ocr import OcrService
    from app.services.transcription import TranscriptionService

    register_whisper(asr_registry)
    register_demo(asr_registry)
    register_tesseract(ocr_registry)

    lexicon = Lexicon(paths.lexicon_db())
    seed = paths.bundle_root() / "app" / "language" / "data" / "seed_lexicon.jsonl"
    if seed.is_file():
        added = lexicon.seed_from(seed)
        if added:
            klogging.get("ksav").info("seeded %d dictionary terms", added)

    service = TranscriptionService(settings, lexicon)
    # Two queues rather than one: a page being read should not sit behind a
    # three hour shiur, and each journals into its own folder so a restart
    # restores them independently.
    queue = JobQueue(service.make_runner(), paths.jobs_dir() / "transcribe")
    queue.restore()
    queue.start()

    ocr_service = OcrService(settings, manager=ModelManager())
    ocr_queue = JobQueue(ocr_service.make_runner(), paths.jobs_dir() / "ocr")
    ocr_queue.restore()
    ocr_queue.start()

    return lexicon, queue, service, ocr_queue, ocr_service


def build_window(settings, hardware, recommendation, manager,
                 lexicon=None, queue=None, service=None,
                 ocr_queue=None, ocr_service=None):
    from PySide6.QtWidgets import QMainWindow

    from app.ui.shell import Shell

    window = QMainWindow()
    window.setWindowTitle("Ksav")
    window.resize(settings.ui.window_width, settings.ui.window_height)
    window.setMinimumSize(940, 620)

    shell = Shell(settings, hardware, recommendation, manager,
                  lexicon=lexicon, queue=queue, service=service,
                  ocr_queue=ocr_queue, ocr_service=ocr_service)
    window.setCentralWidget(shell)
    shell.apply_theme()

    original_close = window.closeEvent

    def on_close(event):
        shell.persist()
        for background in (queue, ocr_queue):
            if background is not None:
                # Journalled work resumes next launch; this stops the worker.
                background.stop()
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
    lexicon, queue, service, ocr_queue, ocr_service = build_services(settings)

    app = build_application()
    window, _shell = build_window(
        settings, hardware, recommendation, manager,
        lexicon=lexicon, queue=queue, service=service,
        ocr_queue=ocr_queue, ocr_service=ocr_service,
    )
    window.show()
    try:
        return app.exec()
    finally:
        queue.stop()
        ocr_queue.stop()
        lexicon.close()


if __name__ == "__main__":
    raise SystemExit(main())
