"""Putting recognised blocks into the order a person would read them.

The hard part is not finding the blocks, it is deciding what comes next. A page
of Hebrew in two columns reads right column first. The same page with an English
abstract at the top reads that first, left to right. Getting this wrong produces
text that is individually correct and collectively nonsense.

Column detection is a vertical projection: a column gutter is a tall run of
pixels with no ink in it. That handles the regular two and three column layouts
that newsletters, schedules and most seforim use. It does not handle a Gemara
page, where Rashi and Tosafos wrap around the text, and nothing here pretends
otherwise: those pages fall back to a single column and the manual region tool.
"""

from __future__ import annotations

import numpy as np

from ..core.models import BlockKind, TextBlock
from ..language.normalize import is_hebrew


def direction_of(text: str) -> str:
    """Which way a block reads. Per block, not per page.

    The first strong character decides, which is what the Unicode bidi
    algorithm does for paragraph direction, and therefore what Word, a browser
    and Ksav's own PDF export will all do with the same text. Counting
    characters instead was tried and got the common case wrong: "The Gemara asks
    a kashya" written with the Torah terms in Hebrew has as many Hebrew letters
    as Latin ones, but it is plainly an English sentence.
    """
    for char in text:
        if is_hebrew(char):
            return "rtl"
        if char.isalpha() and char.isascii():
            return "ltr"
    return "ltr"


def find_column_gutters(binary, min_gap_ratio: float = 0.035) -> list[int]:
    """The x positions where a page splits into columns.

    ``binary`` is ink as non zero. A gutter is a vertical band with no ink that
    runs most of the page height and is wide enough not to be the space between
    two words.
    """
    height, width = binary.shape[:2]
    ink_per_column = (binary > 0).sum(axis=0)
    # A column of pixels counts as empty if almost nothing is in it: a stray
    # speck should not bridge a gutter.
    empty = ink_per_column <= max(1, height * 0.005)

    min_gap = max(12, int(width * min_gap_ratio))
    gutters: list[int] = []
    run_start = None

    for x, is_empty in enumerate(empty):
        if is_empty and run_start is None:
            run_start = x
        elif not is_empty and run_start is not None:
            if x - run_start >= min_gap:
                # Ignore the page margins: they are not gutters.
                if run_start > width * 0.12 and x < width * 0.88:
                    gutters.append((run_start + x) // 2)
            run_start = None

    return gutters


def assign_columns(blocks: list[TextBlock], gutters: list[int]) -> dict[int, int]:
    """Which column each block sits in, numbered left to right."""
    if not gutters:
        return {id(b): 0 for b in blocks}
    out = {}
    for block in blocks:
        centre = block.bbox[0] + block.bbox[2] / 2
        out[id(block)] = sum(1 for g in gutters if centre > g)
    return out


def order(blocks: list[TextBlock], gutters: list[int], page_direction: str) -> list[TextBlock]:
    """Set ``reading_order`` on each block and return them in that order.

    Columns first, in the page's direction, then down each column. A block that
    spans the gutters is treated as a heading and floated to the top, which is
    what a banner across a newsletter actually is.
    """
    if not blocks:
        return []

    columns = assign_columns(blocks, gutters)
    page_width = max(b.bbox[0] + b.bbox[2] for b in blocks)
    spanning = [b for b in blocks if gutters and b.bbox[2] > page_width * 0.7]
    rest = [b for b in blocks if b not in spanning]

    def column_key(block: TextBlock) -> int:
        index = columns[id(block)]
        # Right to left pages read the rightmost column first.
        return -index if page_direction == "rtl" else index

    spanning.sort(key=lambda b: b.bbox[1])
    rest.sort(key=lambda b: (column_key(b), b.bbox[1], b.bbox[0]))

    ordered = spanning + rest
    for position, block in enumerate(ordered):
        block.reading_order = position
    return ordered


def classify(blocks: list[TextBlock]) -> None:
    """Mark the obvious headings.

    A single short line noticeably taller than the body text is a heading. This
    is a heuristic and is only used for formatting, never for the text itself.
    """
    if len(blocks) < 3:
        return
    heights = [b.bbox[3] for b in blocks if b.text.strip()]
    if not heights:
        return
    typical = float(np.median(heights))

    for block in blocks:
        lines = block.text.strip().count("\n") + 1
        if lines == 1 and block.bbox[3] > typical * 1.4 and len(block.text.strip()) < 60:
            block.kind = BlockKind.HEADING
