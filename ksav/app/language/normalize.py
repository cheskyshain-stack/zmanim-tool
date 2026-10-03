"""Turning text into tokens that keep their place in the original string.

Every correction Ksav makes points at a character span in the engine's own
output, so the tokenizer has to carry offsets. That is the whole reason this is
not a call to ``str.split()``.

Normalisation is deliberately shallow. It folds case and strips the punctuation
that clings to a word, and it leaves Hebrew alone entirely. Anything cleverer
belongs in the phonetic layer, where a wrong guess is only a suggestion.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

# A word is a run of letters, digits, and the marks that live inside Yeshivish
# transliterations: the apostrophe in shakla v'tarya, the hyphen in Bein
# ha-Shemashos. Trailing punctuation is left outside the token.
_WORD = re.compile(r"[^\W_]+(?:['’\-][^\W_]+)*", re.UNICODE)

HEBREW_RANGE = (0x0590, 0x05FF)


@dataclass(frozen=True)
class Token:
    """One word, and exactly where it sits in the source string."""

    text: str
    start: int
    end: int
    index: int

    @property
    def norm(self) -> str:
        return normalize(self.text)


def tokenize(text: str) -> list[Token]:
    return [
        Token(m.group(0), m.start(), m.end(), i)
        for i, m in enumerate(_WORD.finditer(text))
    ]


def normalize(word: str) -> str:
    """The form used for dictionary lookup.

    Case folded, with apostrophes and hyphens removed so that ``v'tarya``,
    ``vtarya`` and ``v-tarya`` are one key. Combining marks are stripped from
    Latin text only: Hebrew nekudos are meaningful and are left in place.
    """
    if not word:
        return ""
    if is_hebrew(word):
        return word
    folded = unicodedata.normalize("NFKD", word)
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    return re.sub(r"['’\-]", "", folded).casefold()


def is_hebrew(text: str) -> bool:
    """True when the string is written in Hebrew characters."""
    for char in text:
        if HEBREW_RANGE[0] <= ord(char) <= HEBREW_RANGE[1]:
            return True
    return False


def strip_nekudos(text: str) -> str:
    """Remove Hebrew vowel points, keeping the letters.

    Useful when comparing a pointed form from a chumash against an unpointed
    form in the dictionary. Not used on output, where the nekudos are the point.
    """
    return "".join(
        c for c in unicodedata.normalize("NFD", text)
        if not (0x0591 <= ord(c) <= 0x05C7)
    )


def ngrams(tokens: list[Token], max_length: int) -> list[tuple[tuple[str, ...], int, int]]:
    """Every run of up to ``max_length`` tokens, as (normalised key, first, last).

    Longest runs come first at each position, so a caller matching greedily finds
    ``shulchan aruch harav`` before it finds ``shulchan aruch``.
    """
    out = []
    for start in range(len(tokens)):
        limit = min(max_length, len(tokens) - start)
        for length in range(limit, 0, -1):
            key = tuple(tokens[start + i].norm for i in range(length))
            out.append((key, start, start + length - 1))
    return out


def title_case_like(replacement: str, original: str) -> str:
    """Match the shape of the word being replaced.

    If the engine wrote ``Camera`` at the start of a sentence, the correction
    should read ``Gemara``, not ``gemara``. If it wrote ``CAMERA``, the user was
    probably shouting and that should survive too.
    """
    if not original or not replacement:
        return replacement
    if is_hebrew(replacement):
        return replacement
    if original.isupper() and len(original) > 1:
        return replacement.upper()
    if original[0].isupper():
        return replacement[0].upper() + replacement[1:]
    return replacement


def split_by_script(text: str) -> list[tuple[str, bool]]:
    """Break a mixed string into runs, each entirely Hebrew or entirely not.

    Both exporters need this. Word needs it to mark Hebrew runs as complex
    script; PDF needs it because a PDF has no layout engine and each run has to
    be drawn with a font that actually contains its letters.

    Spaces and punctuation join whichever run they follow, so a Hebrew word does
    not get its trailing space set in the Latin font and vice versa.
    """
    if not text:
        return []
    runs: list[tuple[str, bool]] = []
    current: list[str] = []
    current_hebrew = is_hebrew(text[0])
    for char in text:
        char_hebrew = is_hebrew(char) if char.strip() else current_hebrew
        if char_hebrew != current_hebrew:
            runs.append(("".join(current), current_hebrew))
            current, current_hebrew = [], char_hebrew
        current.append(char)
    runs.append(("".join(current), current_hebrew))
    return [(t, h) for t, h in runs if t]
