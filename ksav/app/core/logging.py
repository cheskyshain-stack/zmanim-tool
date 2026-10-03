"""Logging setup.

Logs go to a rotating file under the data root and, in development, to stderr.
They are deliberately local only: there is no crash reporter and nothing is
transmitted anywhere. If a user wants to send a log they can attach the file
themselves.
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import sys

from . import paths

_CONFIGURED = False
_FORMAT = "%(asctime)s %(levelname)-7s %(name)-28s %(message)s"


def configure(level: int = logging.INFO) -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return
    paths.ensure_dirs()

    root = logging.getLogger()
    root.setLevel(level)

    handler = logging.handlers.RotatingFileHandler(
        paths.logs_dir() / "ksav.log",
        maxBytes=2_000_000,
        backupCount=3,
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter(_FORMAT))
    root.addHandler(handler)

    if os.environ.get("KSAV_DEV") or not getattr(sys, "frozen", False):
        stream = logging.StreamHandler(sys.stderr)
        stream.setFormatter(logging.Formatter(_FORMAT))
        root.addHandler(stream)

    _CONFIGURED = True


def get(name: str) -> logging.Logger:
    return logging.getLogger(name)
