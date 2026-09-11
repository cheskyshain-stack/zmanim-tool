"""OCR engine lookup. Mirrors the speech registry deliberately: one shape to learn."""

from __future__ import annotations

from typing import Callable

from .base import OcrEngine

_FACTORIES: dict[str, Callable[[], OcrEngine]] = {}
_CACHE: dict[str, OcrEngine] = {}


def register(engine_id: str, factory: Callable[[], OcrEngine]) -> None:
    _FACTORIES[engine_id] = factory


def available_ids() -> list[str]:
    return list(_FACTORIES)


def get(engine_id: str) -> OcrEngine:
    if engine_id not in _CACHE:
        factory = _FACTORIES.get(engine_id)
        if factory is None:
            raise KeyError(
                f"No OCR engine registered as '{engine_id}'. "
                f"Known engines: {', '.join(sorted(_FACTORIES)) or 'none'}"
            )
        _CACHE[engine_id] = factory()
    return _CACHE[engine_id]


def describe() -> list[tuple[str, str, bool, str]]:
    out = []
    for engine_id in sorted(_FACTORIES):
        engine = get(engine_id)
        usable, reason = engine.is_available()
        out.append((engine_id, engine.name, usable, reason))
    return out


def reset() -> None:
    _CACHE.clear()
