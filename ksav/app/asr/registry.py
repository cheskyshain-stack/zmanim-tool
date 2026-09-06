"""Engine lookup.

Engines register themselves here by id. The services layer asks for an id and
gets an instance, so no service or UI code mentions a concrete engine.
"""

from __future__ import annotations

from typing import Callable

from .base import AsrEngine

_FACTORIES: dict[str, Callable[[], AsrEngine]] = {}
_CACHE: dict[str, AsrEngine] = {}


def register(engine_id: str, factory: Callable[[], AsrEngine]) -> None:
    _FACTORIES[engine_id] = factory


def available_ids() -> list[str]:
    return list(_FACTORIES)


def get(engine_id: str) -> AsrEngine:
    if engine_id not in _CACHE:
        factory = _FACTORIES.get(engine_id)
        if factory is None:
            raise KeyError(
                f"No speech engine registered as '{engine_id}'. "
                f"Known engines: {', '.join(sorted(_FACTORIES)) or 'none'}"
            )
        _CACHE[engine_id] = factory()
    return _CACHE[engine_id]


def describe() -> list[tuple[str, str, bool, str]]:
    """(id, name, usable, reason) for every registered engine, for the Settings screen."""
    out = []
    for engine_id in sorted(_FACTORIES):
        engine = get(engine_id)
        usable, reason = engine.is_available()
        out.append((engine_id, engine.name, usable, reason))
    return out


def reset() -> None:
    """Drop cached instances. Used by tests and after a settings change."""
    _CACHE.clear()
