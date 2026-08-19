"""Laying a week card's times out: how many to a line, and lining the colons up.

The web version does this by walking the rendered DOM, because by the time it runs the
cell is already markup and splitting HTML on a "/" would cut through the slash in a closing
tag. Here the same work happens on the engine's own string, before anything renders it,
which is both simpler and testable without a graphics stack.

Nothing in this file imports Qt.
"""
import math
import re

from ..engine.fmt import UL_END, UL_START
from ..engine.util import NBSP, SLASH

# Counting times rather than separators, because there is no one separator to count. The
# formulas join with "/", the שחרית schedule uses commas, and a typed list is spaced.
# Splitting on punctuation missed typed times entirely; a time is recognisable on its own.
TIME = re.compile(r"\d{1,2}:\d{2}\*{0,3}")
LETTER = re.compile(r"[^\W\d_]", re.UNICODE)
SEPARATOR_TAIL = re.compile(r"[\s,/" + NBSP + r"]+$")


def sizes_for(n: int, max_per_line: int):
    """How to split n times over as few lines as the cap allows, as evenly as those lines
    can be.

    Filling each line to the cap instead leaves whatever is over sitting alone: a run of
    four with a cap of three came out three and then a single 3:00, which is what a חורף
    מנחה ערב שבת does every week once the clocks go back. Seven becomes 2, 2, 3 rather than
    3, 3, 1, and the fuller line goes last so the block builds downwards instead of tailing
    off.
    """
    if n <= 0:
        return []
    lines = max(1, math.ceil(n / max_per_line))
    base, extra = divmod(n, lines)
    return [base + (1 if i >= lines - extra else 0) for i in range(lines)]


def _cut_before(text: str, at: int) -> int:
    """Where a break in front of the time at `at` really belongs.

    An underlined time is wrapped in sentinels, and cutting at the digits would put the
    break between the sentinel and its own text, which paints a rule out to the edge of
    the line above. So the cut walks back past the lead-in and out of the underline.
    """
    cut = at
    while cut > 0 and text[cut - 1].isspace():
        cut -= 1
    if cut > 0 and text[cut - 1] == UL_START:
        cut -= 1
    return cut


def cap_times_per_line(text: str, max_per_line: int) -> str:
    """At most max_per_line times to a line.

    Counting resets at every break the value already has, so a value that arrives in two
    lines keeps them and only an over-long line is broken further.
    """
    if not text:
        return text
    lines = text.split("\n")
    counts = [len(TIME.findall(line)) for line in lines]

    # A cell of nothing but times, where the value's own break falls somewhere that leaves
    # a line over the cap, is laid out fresh as one run: the workbook writes מנחה ערב שבת
    # as three times and then four, and honouring that break gives 3, 2, 2 where laying the
    # seven out afresh gives 2, 2, 3. Only when a break is needed anyway, so a cell that
    # already fits keeps the grouping the value asked for. Only when the cell is times and
    # separators, so the שחרית schedule keeps its heading and "שקיעה 4:48" is never joined
    # onto the line above it.
    if not LETTER.search(text) and any(n > max_per_line for n in counts):
        lines = [SLASH.join(part.strip() for part in lines if part.strip())]
        counts = [len(TIME.findall(lines[0]))]

    out = []
    for line, count in zip(lines, counts):
        out.append(_split_line(line, sizes_for(count, max_per_line)))
    return "\n".join(out)


def _split_line(line: str, sizes) -> str:
    if len(sizes) <= 1:
        return line
    starts = [m.start() for m in TIME.finditer(line)]
    cuts, taken = [], 0
    for size in sizes[:-1]:
        taken += size
        cuts.append(_cut_before(line, starts[taken]))
    pieces, previous = [], 0
    for cut in cuts:
        pieces.append(SEPARATOR_TAIL.sub("", line[previous:cut]))
        previous = cut
    pieces.append(line[previous:])
    return "\n".join(piece.lstrip() for piece in pieces if piece.strip())


def _first_time(line: str):
    """The first time anywhere in the line.

    Anywhere, not only at the start: in "שקיעה 4:48" the Hebrew word comes first in the
    string, so a match anchored to the start found no time to align and left that line's
    colon a digit to the left of every other colon on the card.
    """
    return TIME.search(line)


def has_two_digit_hour_at_line_start(text: str) -> bool:
    """Whether any line here opens with a two digit hour, which is what decides whether
    padding is worth doing at all.

    Asked of a whole card rather than one cell: the colons should line up down the page, so
    a שחרית block of single digit hours is padded onto the same axis as a מעריב block that
    runs past ten, instead of each block finding its own. Where no line on the card has a
    long hour nothing is padded, since it would move every line equally and change nothing,
    except on a line that opens with a word rather than a time, where it would shift one
    and not the other and pull the two out of line.
    """
    for line in str(text or "").split("\n"):
        if re.match(r"^[\s" + NBSP + UL_START + r"]*\d{2}:\d{2}", line):
            return True
    return False


def needs_pad(line: str) -> bool:
    """Whether this line's first time has a one digit hour, and so wants a digit of blank
    in front of it to put its colon on the axis."""
    match = _first_time(line)
    if not match:
        return False
    return len(match.group(0).split(":")[0]) == 1


def marks_used(text: str):
    """Which location marks appear, for the card's own key. One star is בעזר״נ and two is
    באולם השמחות; an underline is למטה and is looked for separately."""
    found = set()
    for match in re.finditer(r"\d{1,2}:\d{2}(\*{1,3})", str(text or "")):
        found.add(match.group(1))
    return found


def has_underline(text: str) -> bool:
    return UL_START in str(text or "")


def format_label(label: str) -> str:
    """A row's name, taken from the chart's column header.

    A header is written to wrap inside a narrow chart column, so its own breaks mean
    nothing on a card and are flattened away. A פלג row is the exception: the name is two
    things, which מנחה it is and which פלג it is measured to, and run onto one line it reads
    as neither. Those keep a break in front of פלג, which is what separates "מנחה (למטה)"
    from "פלג מ״א". No other header wants one: "הדלקת נרות" and "מנחה ערב שבת" are single
    names that only wrapped because the column was narrow.
    """
    flat = re.sub(r"\s+", " ", str(label or "")).strip()
    return re.sub(r" (פלג )", r"\n\1", flat, count=1)


# --- authored markup ------------------------------------------------------------------
# A value typed into a cell, or the שחרית schedule out of settings, arrives as markup
# rather than as engine text, and it has to be broken to the same number of times a line as
# everything else: on the weekday card the web version caps every row at one time a line,
# the שחרית schedule included. Splitting the string at a time boundary would leave a tag
# open on one line and unopened on the next, so the split walks a token stream and closes
# and reopens whatever was open across the cut.
_TOKEN = re.compile(r"<[^>]+>|[^<]+")
_TAG_NAME = re.compile(r"^</?\s*([a-zA-Z0-9]+)")
_VOID = {"br", "img", "hr", "input", "wbr"}


def _tag_name(token: str) -> str:
    match = _TAG_NAME.match(token)
    return match.group(1).lower() if match else ""


_BREAK_TAG = re.compile(r"^</?(br|div|p|li)\b", re.IGNORECASE)


def split_html_lines(fragment: str):
    """An authored fragment split into its printed lines, on <br> and on a block boundary.

    A block element is a break as much as a <br> is: the browser's own editor wraps a typed
    second line in a <div> rather than writing a <br>, and treating only <br> as a break
    miscounted the lines of every hand typed cell.

    Split with the tag stack carried across, so a wrapper spanning the break survives on
    both sides. Splitting the string instead left the second line of the שחרית schedule
    outside the span the first line was inside, and it quietly lost its styling.
    """
    stack, lines, current = [], [], []

    def flush():
        if current:
            lines.append(_emit(current))
            current.clear()

    for token in _TOKEN.findall(str(fragment or "")):
        if not token.startswith("<"):
            current.append((token, list(stack)))
            continue
        name = _tag_name(token)
        if _BREAK_TAG.match(token):
            flush()
            if name != "br" and not token.startswith("</"):
                stack.append((name, token))
            elif name != "br" and stack and stack[-1][0] == name:
                stack.pop()
            continue
        if not name or name in _VOID:
            current.append((token, list(stack)))
        elif token.startswith("</"):
            if stack and stack[-1][0] == name:
                stack.pop()
        else:
            stack.append((name, token))
    flush()
    return [line for line in lines if re.sub(r"<[^>]+>", "", line).strip()]


# The separator left stranded at the end of a line by a break put in above it, and the
# space left at the head of the next one. The in-token trim cannot reach either when the
# next time sits inside its own element: the comma after "7:20*" lives in the text outside
# the <u> that holds "7:35", so it survived and the line printed as "7:20*,". The lookahead
# lets the trailing trim reach past whatever closing tags end the line.
_TRAILING_SEPARATOR = re.compile(r"[\s,/" + NBSP + r"]+(?=(?:</[a-zA-Z]+>)*$)")
_LEADING_SPACE = re.compile(r"^((?:<[^>]+>)*)[\s" + NBSP + r"]+")


def tidy_line(line: str) -> str:
    return _LEADING_SPACE.sub(r"\1", _TRAILING_SEPARATOR.sub("", line))


def cap_html_times_per_line(fragment: str, max_per_line: int):
    """The same cap as cap_times_per_line, over markup, returning a list of lines."""
    out = []
    for line in split_html_lines(fragment):
        count = len(TIME.findall(re.sub(r"<[^>]+>", "", line)))
        sizes = sizes_for(count, max_per_line)
        out.extend(_cut_html(line, sizes) if len(sizes) > 1 else [line])
    return [tidy_line(x) for x in out]


def _runs(line: str):
    """The line as a list of (text, tag stack) pairs.

    Flattening to runs first is what makes a clean cut possible. Cutting the string itself
    left a tag open on one line and unopened on the next: the שחרית schedule came out with
    an empty "<u></u>" stranded at the end of a line, because the underline around the next
    time had already been opened before the cut point was reached, and the line after it
    lost the wrapper it was inside.
    """
    stack, out = [], []
    for token in _TOKEN.findall(line):
        if not token.startswith("<"):
            out.append((token, list(stack)))
            continue
        name = _tag_name(token)
        if not name or name in _VOID:
            out.append((token, list(stack)))
            continue
        if token.startswith("</"):
            if stack and stack[-1][0] == name:
                stack.pop()
        else:
            stack.append((name, token))
    return out


def _emit(pieces) -> str:
    """Runs back into markup, opening and closing tags as the stack changes."""
    out, current = [], []
    for text, stack in pieces:
        common = 0
        while common < len(current) and common < len(stack) and current[common] == stack[common]:
            common += 1
        for name, _markup in reversed(current[common:]):
            out.append(f"</{name}>")
        for _name, markup in stack[common:]:
            out.append(markup)
        current = list(stack)
        out.append(text)
    for name, _markup in reversed(current):
        out.append(f"</{name}>")
    return "".join(out)


def _cut_html(line: str, sizes):
    wanted = list(sizes)
    remaining = wanted.pop(0)
    seen = 0
    lines, current = [], []

    for text, stack in _runs(line):
        if text.startswith("<"):
            current.append((text, stack))
            continue
        at = 0
        for match in TIME.finditer(text):
            if seen == remaining and wanted:
                cut = _cut_before(text, match.start())
                # Only when there is something there: an empty run would open the next
                # time's own element and close it again, stranding "<u></u>" at the end of
                # the line above.
                if text[at:cut]:
                    current.append((text[at:cut], stack))
                lines.append(_emit(current))
                current = []
                at = cut
                remaining = wanted.pop(0)
                seen = 0
            seen += 1
        if text[at:]:
            current.append((text[at:], stack))
    lines.append(_emit(current))
    return [x for x in lines if re.sub(r"<[^>]+>", "", x).strip()]
