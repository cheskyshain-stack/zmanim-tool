"""Small Excel-semantics helpers shared by the sheet column ports (js/util.js)."""

# A no-break space, used in every "/"-joined list of times so a pair can never wrap onto
# two lines when a column is narrow. Only a sheet's own explicit newline should ever
# start a new line.
#
# Written as an escape rather than as the character itself: it is invisible in an editor,
# and it reached this file once already as a plain 0x20, which silently moved every
# underlined time one character to the left of where it belongs.
NBSP = "\u00a0"
SLASH = f"{NBSP}/{NBSP}"


def textjoin(delim: str, ignore_empty: bool, parts) -> str:
    flat = []
    for p in parts:
        flat.extend(p) if isinstance(p, list) else flat.append(p)
    kept = [x for x in flat if x != "" and x is not None] if ignore_empty else flat
    return delim.join(kept)


def flatten_non_empty(parts):
    """Flattens nested lists (the HSTACK style pairs) and drops the empties."""
    flat = []
    for p in parts:
        flat.extend(p) if isinstance(p, list) else flat.append(p)
    return [x for x in flat if x != "" and x is not None]


def split_lines_in_half(items, delim: str = SLASH) -> str:
    """Splits a list of options across two printed lines, the first line taking the
    smaller half when the count is odd: 4 to 2+2, 5 to 2+3, 6 to 3+3."""
    cut = len(items) // 2
    lines = [delim.join(items[:cut]), delim.join(items[cut:])]
    return "\n".join(x for x in lines if x)
