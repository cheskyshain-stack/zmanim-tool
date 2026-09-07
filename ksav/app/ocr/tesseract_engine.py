"""Reading a page with Tesseract.

Tesseract is the default because it runs on any processor, ships cleanly under
Apache 2.0, and is honest at roughly 92 to 96 percent on clean modern Hebrew
print. It is not the best OCR available in 2026 and it is not pretending to be:
the ``vlm`` slot in the registry exists for when a stronger model is worth its
hardware, and this engine's job is to work everywhere.

What it does badly is stated rather than discovered. Rashi script produces
nonsense, nekudos are usually dropped, and nineteenth century rabbinic print
lands somewhere in the sixties to eighties. :meth:`quality_note` puts that in
front of the user before they spend an hour correcting a page.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from ..core.logging import get
from ..core.models import BlockKind, PageText, TextBlock
from . import layout, preprocess
from .base import (
    CancelFn,
    OcrCapabilities,
    OcrEngine,
    OcrOptions,
    OcrUnavailable,
    ProgressFn,
    ScriptHint,
)

log = get(__name__)

_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

# Which Tesseract language data each hint wants, and the page segmentation mode
# that suits it. psm 3 is fully automatic; psm 4 assumes a single column of
# variable sized text, which is what a column of a sefer actually is; psm 6
# assumes one uniform block, which is right when the user has drawn a region.
HINT_CONFIG = {
    ScriptHint.AUTO: (["heb", "eng"], 3),
    ScriptHint.HEBREW_PLAIN: (["heb"], 3),
    ScriptHint.HEBREW_NEKUDOS: (["heb"], 3),
    ScriptHint.RASHI: (["heb"], 3),
    ScriptHint.OLD_PRINT: (["heb"], 4),
    ScriptHint.YIDDISH: (["yid", "heb"], 3),
    ScriptHint.MIXED_HE_EN: (["heb", "eng"], 3),
    ScriptHint.LATIN: (["eng"], 3),
}

QUALITY_NOTES = {
    ScriptHint.RASHI: (
        "Rashi script has no good offline model, and Tesseract will produce very "
        "little of use on it. The engine slot for a trained Rashi model exists and "
        "is empty. Expect to type this page rather than correct it."
    ),
    ScriptHint.OLD_PRINT: (
        "Old rabbinic print usually comes out somewhere between 60 and 80 percent "
        "correct, so expect real correction work. The cleanup steps help and do not "
        "solve it."
    ),
    ScriptHint.HEBREW_NEKUDOS: (
        "Nekudos are usually dropped or misread as specks. The letters normally "
        "come through; the vowel points normally do not."
    ),
}


class TesseractEngine(OcrEngine):
    id = "tesseract"
    name = "Tesseract 5"
    capabilities = OcrCapabilities(
        layout_analysis=True,
        reading_order=True,
        per_block_direction=True,
        confidence_scores=True,
        gpu=False,
        supported_hints=tuple(ScriptHint),
    )

    def __init__(self, binary: str | None = None, tessdata: Path | None = None) -> None:
        self._binary = binary
        self._tessdata = tessdata
        self._languages: set[str] | None = None

    # -- availability ----------------------------------------------------

    def binary(self) -> str | None:
        """Prefer the copy shipped with Ksav, fall back to one on the PATH."""
        if self._binary:
            return self._binary
        from ..core import paths

        bundled = paths.VENDOR_DIR / "tesseract" / (
            "tesseract.exe" if sys.platform == "win32" else "tesseract"
        )
        if bundled.is_file():
            self._binary = str(bundled)
            return self._binary
        found = shutil.which("tesseract")
        self._binary = found
        return found

    def is_available(self) -> tuple[bool, str]:
        if self.binary() is None:
            return False, (
                "Tesseract was not found. Reinstall Ksav, which includes it, or "
                "install Tesseract and make sure it is on the PATH."
            )
        try:
            import pytesseract  # noqa: F401
        except ImportError:
            return False, "The pytesseract package is not installed."

        languages = self.languages()
        if not languages:
            return False, "Tesseract is installed but has no language data."
        missing = {"heb", "eng"} - languages
        if missing:
            return True, (
                f"Ready, but missing language data for {', '.join(sorted(missing))}. "
                f"Install it from the Model Vault."
            )
        return True, f"Ready. {len(languages)} languages installed."

    def languages(self) -> set[str]:
        if self._languages is not None:
            return self._languages
        binary = self.binary()
        if not binary:
            self._languages = set()
            return self._languages
        try:
            result = subprocess.run(
                [binary, "--list-langs"], capture_output=True, text=True,
                timeout=20, creationflags=_NO_WINDOW, env=self._env(),
            )
            lines = result.stdout.splitlines() + result.stderr.splitlines()
            self._languages = {
                line.strip() for line in lines
                if line.strip() and " " not in line.strip() and not line.startswith("List")
            }
        except (OSError, subprocess.SubprocessError) as exc:
            log.warning("could not list Tesseract languages: %s", exc)
            self._languages = set()
        return self._languages

    def _env(self) -> dict:
        import os

        env = dict(os.environ)
        if self._tessdata:
            env["TESSDATA_PREFIX"] = str(self._tessdata)
        else:
            from ..core import paths

            bundled = paths.VENDOR_DIR / "tesseract" / "tessdata"
            if bundled.is_dir():
                env["TESSDATA_PREFIX"] = str(bundled.parent)
        return env

    def resolve_languages(self, options: OcrOptions) -> tuple[list[str], str]:
        """What to ask Tesseract for, and a note when it is not what was wanted."""
        wanted, _psm = HINT_CONFIG.get(options.script_hint, (list(options.languages), 3))
        if options.script_hint is ScriptHint.AUTO and options.languages:
            wanted = list(options.languages)

        installed = self.languages()
        available = [lang for lang in wanted if lang in installed]
        note = ""
        missing = [lang for lang in wanted if lang not in installed]

        if missing and "yid" in missing and "heb" in installed:
            available = available or ["heb"]
            note = (
                "Yiddish language data is not installed, so the page was read as "
                "Hebrew. Yiddish spelling differs enough that this will cost accuracy. "
                "Install the Yiddish pack from the Model Vault."
            )
        elif missing:
            note = f"Missing language data for {', '.join(missing)}."

        if not available:
            available = ["eng"] if "eng" in installed else sorted(installed)[:1]
        return available, note

    def quality_note(self, options: OcrOptions) -> str:
        return QUALITY_NOTES.get(options.script_hint, "")

    # -- recognition -----------------------------------------------------

    def recognize(
        self,
        image_path: Path,
        options: OcrOptions,
        on_progress: ProgressFn | None = None,
        should_cancel: CancelFn | None = None,
    ) -> PageText:
        usable, reason = self.is_available()
        if not usable:
            raise OcrUnavailable(reason)

        import cv2
        import numpy as np
        import pytesseract
        from PIL import Image

        image_path = Path(image_path)
        if on_progress:
            on_progress(0, 3, "Opening the page")

        original = preprocess.load(image_path)
        steps = preprocess.Steps()

        if options.preprocess:
            if on_progress:
                on_progress(1, 3, "Cleaning up the image")
            prep_options = preprocess.Options(
                deskew=options.deskew,
                denoise=options.denoise,
                contrast=True,
                binarize=True,
                crop=True,
                auto_orient=options.auto_orient,
            )
            working, steps = preprocess.run(original, prep_options)
        else:
            working = preprocess.to_grayscale(original)

        if should_cancel and should_cancel():
            return PageText(image_path=str(image_path), source_path=str(image_path))

        languages, language_note = self.resolve_languages(options)
        _langs, psm = HINT_CONFIG.get(options.script_hint, (languages, 3))
        if options.regions:
            psm = 6            # the user drew the box, so do not re-segment it

        binary = working if working.ndim == 2 else preprocess.to_grayscale(working)
        height, width = binary.shape[:2]

        # Work out the columns before reading anything. Tesseract, handed a two
        # column page as one image, merges the columns and reads straight across
        # them: the words are right and the sentences are nonsense. Reading each
        # column as its own image is what actually fixes that.
        gutters = (
            layout.find_column_gutters(cv2.bitwise_not(binary))
            if options.detect_columns and not options.regions else []
        )

        strips: list[tuple[int, int, int, int]] = []
        if options.regions:
            strips = list(options.regions)
            psm = 6                    # the user drew the box, do not re-segment
        elif gutters:
            edges = [0] + list(gutters) + [width]
            strips = [
                (edges[i], 0, edges[i + 1] - edges[i], height)
                for i in range(len(edges) - 1)
            ]
            psm = 4                    # one column of variable sized text
        else:
            strips = [(0, 0, width, height)]

        if on_progress:
            on_progress(2, 3, f"Reading the text ({'+'.join(languages)})")

        config = f"--oem 1 --psm {psm}"
        blocks: list[TextBlock] = []

        for x, y, w, h in strips:
            if should_cancel and should_cancel():
                break
            crop = binary[y:y + h, x:x + w]
            if crop.size == 0:
                continue
            rgb = cv2.cvtColor(crop, cv2.COLOR_GRAY2RGB)
            try:
                data = pytesseract.image_to_data(
                    Image.fromarray(rgb),
                    lang="+".join(languages),
                    config=config,
                    output_type=pytesseract.Output.DICT,
                )
            except Exception as exc:
                raise OcrUnavailable(
                    f"{image_path.name} could not be read: {exc}"
                ) from exc
            # Offsets put every box back into page coordinates, so the review
            # screen can highlight the right part of the original image.
            blocks.extend(_blocks_from(data, offset=(x, y)))

        page_direction = layout.direction_of(" ".join(b.text for b in blocks))
        blocks = layout.order(blocks, gutters, page_direction)
        layout.classify(blocks)

        page = PageText(
            blocks=blocks,
            image_path=str(image_path),
            source_path=str(image_path),
            width=width,
            height=height,
            engine_id=self.id,
            rotation=steps.rotated,
        )
        notes = [n for n in (language_note, self.quality_note(options)) if n]
        notes.extend(steps.notes)
        page.notes = notes
        page.preprocessing = steps.summary()
        page.columns = len(gutters) + 1 if gutters else 1

        if on_progress:
            on_progress(3, 3, "Finished")
        return page


def _blocks_from(data: dict, offset: tuple[int, int] = (0, 0)) -> list[TextBlock]:
    """Group Tesseract's word rows into paragraphs.

    Tesseract reports one row per word with block, paragraph and line numbers.
    Paragraph is the right grain for a text block: a line is too fine to be
    useful and a whole block often merges a heading with the text under it.
    """
    grouped: dict[tuple[int, int], dict] = {}
    count = len(data.get("text", []))

    for i in range(count):
        text = (data["text"][i] or "").strip()
        if not text:
            continue
        try:
            confidence = float(data["conf"][i])
        except (TypeError, ValueError):
            confidence = -1.0
        if confidence < 0:
            continue

        key = (data["block_num"][i], data["par_num"][i])
        entry = grouped.setdefault(key, {
            "lines": {}, "x0": 10 ** 9, "y0": 10 ** 9, "x1": 0, "y1": 0,
            "confidence": [],
        })
        line = entry["lines"].setdefault(data["line_num"][i], [])
        line.append(text)

        x = data["left"][i] + offset[0]
        y = data["top"][i] + offset[1]
        w, h = data["width"][i], data["height"][i]
        entry["x0"] = min(entry["x0"], x)
        entry["y0"] = min(entry["y0"], y)
        entry["x1"] = max(entry["x1"], x + w)
        entry["y1"] = max(entry["y1"], y + h)
        entry["confidence"].append(confidence)

    out: list[TextBlock] = []
    for entry in grouped.values():
        lines = [" ".join(words) for _n, words in sorted(entry["lines"].items())]
        text = "\n".join(lines).strip()
        if not text:
            continue
        confidence = sum(entry["confidence"]) / len(entry["confidence"])
        out.append(TextBlock(
            text=text,
            bbox=(entry["x0"], entry["y0"], entry["x1"] - entry["x0"],
                  entry["y1"] - entry["y0"]),
            kind=BlockKind.PARAGRAPH,
            direction=layout.direction_of(text),
            confidence=round(confidence / 100, 3),
        ))
    return out


def register_into(registry) -> None:
    registry.register(TesseractEngine.id, TesseractEngine)
