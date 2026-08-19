"""Time formatting, ported from js/format.js.

The workbook writes its times through TEXT(...,"h:mm") and rounds them with ROUNDUP /
ROUNDDOWN / CEILING(...,1/1440); these are those idioms.
"""
import math
import re

from .jsmath import js_round
from .util import NBSP

# Guards against floating point noise landing just the wrong side of a minute. Small
# enough that no real difference can hide under it, large enough to absorb the last bit
# of a double.
EPS = 1e-7

# Underline is carried through every formula as two Private Use Area sentinels wrapping
# the text, and turned into real markup only when something renders it. That keeps the
# formula code free of any presentation concern, and the characters cannot collide with
# real content.
UL_START = "\ue000"
UL_END = "\ue001"


def ceil_to_minute(day_fraction: float) -> float:
    return math.ceil(day_fraction * 1440 - EPS) / 1440


def floor_to_minute(day_fraction: float) -> float:
    return math.floor(day_fraction * 1440 + EPS) / 1440


def round_to_minute(day_fraction: float) -> float:
    return js_round(day_fraction * 1440) / 1440


def format_time(day_fraction: float) -> str:
    """TEXT(time,"h:mm"): a 12 hour clock with no am/pm, and hour 0 shown as 12."""
    frac = day_fraction % 1.0
    total_minutes = int(js_round(frac * 1440)) % 1440
    h24, minute = divmod(total_minutes, 60)
    h12 = 12 if h24 % 12 == 0 else h24 % 12
    return f"{h12}:{minute:02d}"


def underline_time(value) -> str:
    """UNDERLINE_TIME: marks a time as the alternate one, which prints underlined.

    Takes either a raw day fraction or an already formatted string, because both forms
    appear in the workbook's own formulas.

    The no-break space after the sentinel is the workbook's lead-in, kept so this stays a
    faithful port. Renderers strip whitespace straight after the sentinel: on a left
    aligned card it showed as an uneven gap in front of underlined times.
    """
    text = format_time(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else value
    return UL_START + NBSP + text + UL_END


def _expand_time_digits(digits: str):
    """"1220" to "12:20", "130" to "1:30", "8" to "8:00".

    None for anything that is not a plausible time on a 12 hour board, so the caller can
    leave those digits alone rather than mangle them.
    """
    if len(digits) <= 2:
        hour, minute = int(digits), "00"
    else:
        split = 1 if len(digits) == 3 else 2
        hour, minute = int(digits[:split]), digits[split:]
    if hour < 1 or hour > 12 or int(minute) > 59:
        return None
    return f"{hour}:{minute}"


_SHORTHAND = re.compile(r"(?<![\d:])\d{1,4}(?![\d:])")
_TIME_GAP = re.compile(r"(\d{1,2}:\d{2}\*{0,3})\s+(?=\d{1,2}:\d{2})")


def normalize_time_shorthand(text: str) -> str:
    """Expands bare digit runs into times, so a schedule can be typed "1220 130".

    The lookarounds skip digits already sitting next to a colon; without them the "7" of
    an existing "7:15" would itself expand to "7:00".
    """
    return _SHORTHAND.sub(lambda m: _expand_time_digits(m.group(0)) or m.group(0), text)


def normalize_time_list(text: str) -> str:
    """The same, with the spacing between two times tidied to a single space.

    Whitespace anywhere else, inside a Hebrew word say, is deliberately left alone.
    """
    return _TIME_GAP.sub(r"\1 ", normalize_time_shorthand(text).strip())
