"""A phonetic key tuned for Yeshivish transliteration.

There is no standard spelling for these words. One person writes Tosafos,
another Tosfos, another Tosafot. Double Metaphone was built for English surnames
and does badly on the axes that actually vary here, so this is a small key built
around those axes specifically:

* **ch, kh, h** for the ches and chof, which get written every possible way.
* **tz, ts, z** for the tzadi.
* **s against t** for the sav, which is the Ashkenazi and Sephardi split:
  Shabbos against Shabbat, Tosfos against Tosafot.
* **Vowels**, which carry almost no information in transliteration: Rambam,
  Rambom, machlokes, machloikes.

What this is NOT for. It catches spelling variants of a word the dictionary
already knows. It does not catch a recognition mistake like the model writing
"camera" when the speaker said Gemara, because those are acoustic confusions
rather than spelling ones and there is nothing phonetic connecting a gimel to a
kof. Those belong in the dictionary as an explicit heard as variant.

Because the key is coarse it will pair unrelated words (shver and svara both
reduce to SVR). Every phonetic hit is therefore a suggestion the user sees, never
a change applied on its own, and similarity is checked against the raw spelling
as well before anything is offered.
"""

from __future__ import annotations

import re

from .normalize import is_hebrew, normalize

# Longest first: tsch before sch before sh, or the shorter one wins wrongly.
_DIGRAPHS = [
    ("tsch", "X"),
    ("sch", "S"),
    ("sh", "S"),
    ("ch", "X"),
    ("kh", "X"),
    ("gh", "G"),
    ("tz", "Z"),
    ("ts", "Z"),
    ("th", "T"),
    ("ph", "F"),
    ("ck", "K"),
]

_SINGLE = {
    "a": "", "e": "", "i": "", "o": "", "u": "", "y": "", "h": "",
    "b": "B", "v": "V", "w": "V",
    "c": "K", "k": "K", "q": "K",
    "g": "G", "d": "D",
    "t": "T", "s": "S", "z": "Z",
    "f": "F", "p": "F",       # fei and pei are one letter with a dot
    "l": "L", "m": "M", "n": "N", "r": "R",
    "j": "Y", "x": "KS",
}

_REPEAT = re.compile(r"(.)\1+")


def key(word: str) -> str:
    """The primary phonetic key. Empty for Hebrew script and for nonsense."""
    if not word or is_hebrew(word):
        return ""
    text = normalize(word)
    text = re.sub(r"[^a-z]", "", text)
    if not text:
        return ""

    # An initial vowel is worth keeping: Aruch and Ruach should not collide.
    lead = text[0].upper() if text[0] in "aeiou" else ""

    # Digraph codes are written in upper case so they cannot be mistaken for
    # input letters on the next pass. Lower casing them caused ch to become x,
    # which was then re-read as the letter x and coded KS.
    for digraph, code in _DIGRAPHS:
        text = text.replace(digraph, code)

    out = []
    for char in text:
        if char.isupper():
            out.append(char)          # already a digraph code
        elif char in _SINGLE:
            out.append(_SINGLE[char])
        else:
            out.append(char.upper())

    result = lead + "".join(out)
    return _REPEAT.sub(r"\1", result)


def keys(word: str) -> set[str]:
    """Every key this word could plausibly be filed under.

    The sav is the reason there is more than one. A word ending in a T also gets
    the S form, so Tosafot finds Tosfos, without conflating T and S everywhere
    else in the word where they are genuinely different letters.
    """
    primary = key(word)
    if not primary:
        return set()
    out = {primary}
    if primary.endswith("T"):
        out.add(primary[:-1] + "S")
    elif primary.endswith("S"):
        out.add(primary[:-1] + "T")
    return out


def similarity(a: str, b: str) -> float:
    """How close two spellings look, 0 to 1.

    Used as a second opinion on a phonetic match, because the key is coarse
    enough to pair words that share no letters in common.
    """
    a, b = normalize(a), normalize(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    distance = _levenshtein(a, b)
    return max(0.0, 1.0 - distance / max(len(a), len(b)))


def _levenshtein(a: str, b: str) -> int:
    if len(a) < len(b):
        a, b = b, a
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (ca != cb),
            ))
        previous = current
    return previous[-1]
