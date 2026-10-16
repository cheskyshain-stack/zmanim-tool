"""The OCR interface.

Recognition and layout are deliberately separate concerns. A page can be laid
out well and read badly, or the reverse, and keeping them apart means the Rashi
script problem can be attacked by swapping the recogniser without touching
column detection.

``OcrOptions.script_hint`` is where the specialised cases in the brief attach:
Hebrew with nekudos, Rashi script, an old sefer, a two column newsletter. An
engine that cannot honour a hint ignores it, and ``supported_hints`` says so up
front so the interface never offers a choice that does nothing.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Callable

from ..core.models import PageText


class ScriptHint(str, Enum):
    AUTO = "auto"
    HEBREW_PLAIN = "hebrew_plain"          # modern Hebrew print, no vowel points
    HEBREW_NEKUDOS = "hebrew_nekudos"      # chumash, siddur
    RASHI = "rashi"                        # not solved offline yet, see docs
    OLD_PRINT = "old_print"                # nineteenth century seforim
    YIDDISH = "yiddish"
    MIXED_HE_EN = "mixed_he_en"
    LATIN = "latin"


HINT_LABELS = {
    ScriptHint.AUTO: "Detect automatically",
    ScriptHint.HEBREW_PLAIN: "Hebrew, no nekudos",
    ScriptHint.HEBREW_NEKUDOS: "Hebrew with nekudos",
    ScriptHint.RASHI: "Rashi script",
    ScriptHint.OLD_PRINT: "Old printed sefer",
    ScriptHint.YIDDISH: "Yiddish",
    ScriptHint.MIXED_HE_EN: "Mixed Hebrew and English",
    ScriptHint.LATIN: "English only",
}


@dataclass
class OcrOptions:
    model_id: str = ""
    languages: list[str] = field(default_factory=lambda: ["heb", "eng"])
    script_hint: ScriptHint = ScriptHint.AUTO
    preprocess: bool = True
    deskew: bool = True
    denoise: bool = True
    auto_orient: bool = True
    detect_columns: bool = True
    dpi: int = 300
    # Regions the user drew by hand. When present the engine reads only these,
    # which is the escape hatch for a layout nothing can parse automatically.
    regions: list[tuple[int, int, int, int]] = field(default_factory=list)


@dataclass
class OcrCapabilities:
    layout_analysis: bool = False
    reading_order: bool = False
    per_block_direction: bool = False
    confidence_scores: bool = False
    gpu: bool = False
    supported_hints: tuple[ScriptHint, ...] = (ScriptHint.AUTO,)


ProgressFn = Callable[[int, int, str], None]      # done, total, message
CancelFn = Callable[[], bool]


class OcrUnavailable(RuntimeError):
    """The engine cannot run. The message is shown to the user verbatim."""


class OcrEngine(abc.ABC):
    id: str = ""
    name: str = ""
    capabilities = OcrCapabilities()

    @abc.abstractmethod
    def is_available(self) -> tuple[bool, str]:
        ...

    @abc.abstractmethod
    def recognize(
        self,
        image_path: Path,
        options: OcrOptions,
        on_progress: ProgressFn | None = None,
        should_cancel: CancelFn | None = None,
    ) -> PageText:
        """Read one page image and return its text blocks in reading order."""

    def unload(self) -> None:
        ...
