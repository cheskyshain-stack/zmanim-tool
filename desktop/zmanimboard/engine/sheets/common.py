"""Helpers shared between שבת קיץ and שבת חורף (js/sheets/common.js).

Both charts use the same day-of-year window gate and exactly the same Erev Shabbos
main-Mincha menu formula.
"""
import math
from datetime import date

from .. import zmanim as Z
from ..fmt import ceil_to_minute, format_time, underline_time
from ..hebrew_calendar import hebrew_date_extended
from ..solar import date_from_serial
from ..util import NBSP, SLASH, flatten_non_empty, split_lines_in_half


def T(h: int, m: int) -> float:
    """Excel TIME(h, m) as a fraction of a day."""
    return ((h % 24) + m / 60) / 24


def in_spring_dst_window(d: date, s) -> bool:
    """DST active and month before June: specifically the *spring* window, roughly the
    second Sunday of March through Pesach, deliberately excluding the autumn window from
    Sukkos to the first Sunday of November, which is also nominally DST but must not count
    here.

    The same test decides when a שבת חורף season needs its final page generated as an
    actual שבת קיץ chart, and that switch must happen once near the season's end, not at
    Sukkos just because the clock happens to still read DST there too.
    """
    return Z.dst_local(d, s) and d.month < 6


def in_plag_window(serial: float, s) -> bool:
    """The spring DST window, or Hebrew day of year below 192: when the Plag based early
    minyanim are offered at all. The day-of-year branch covers שבת קיץ's own late season
    stretch, Elul into Tishrei, which has nothing to do with DST."""
    d = date_from_serial(serial)
    doy = hebrew_date_extended(serial, s.use_gregorian_before_1582).day_of_year
    return in_spring_dst_window(d, s) or doy < 192


def friday_main_mincha_menu(friday: date, s) -> str:
    """The Erev Shabbos main Mincha menu, קיץ column L and חורף column I, the same formula
    on both. Printed across two lines, split as evenly as it goes, the longer line second.
    """
    mgl = Z.mincha_gedola_lechumra(friday, s)
    items = flatten_non_empty([
        [underline_time(max(T(12, 30), mgl)), underline_time(T(1, 0))] if not Z.dst_local(friday, s) else "",
        underline_time(max(mgl, T(13, 15))) if mgl < T(13, 20) else "",
        underline_time(mgl if mgl > T(13, 35) else T(1, 35)),
        "1:50",
        "2:15",
        "3:00",
    ])
    return split_lines_in_half(items)


def shabbos_mincha_menu(shabbos: date, s) -> str:
    """The Shabbos day Mincha menu, column C on both charts, the same formula and the same
    two line split."""
    sunset_val = Z.sunset(shabbos, s)
    candidates = [T(5, 30), T(6, 0), T(6, 30)]
    gates = [T(17, 30), T(18, 0), T(18, 30)]
    kept = [underline_time(t) for t, gate in zip(candidates, gates) if gate <= sunset_val - 1 / 24]
    items = flatten_non_empty([
        "1:40" if Z.dst_local(shabbos, s) else "1:20",
        kept,
        # The original formula uses ROUNDUP here, not ROUNDDOWN as most other columns do.
        format_time(min(ceil_to_minute(sunset_val - 45 / 1440), T(19, 0))),
        underline_time(min(ceil_to_minute(sunset_val - 30 / 1440), T(19, 30))),
    ])
    return split_lines_in_half(items)


def _floor_min(x: float) -> float:
    return math.floor(x * 1440 + 1e-7) / 1440


def shacharis_line() -> str:
    """Column E on both charts: fixed, and not date dependent. The no-break spaces around
    the slash are what stop it wrapping onto a second line."""
    return f"{underline_time(T(7, 30))}{SLASH}8:15"


def candle_lighting_cell(friday: date, s) -> str:
    """Column H on both charts: candle lighting, then שקיעה underneath it."""
    sunset_elev_friday = _floor_min(Z.sunset_elev(friday, s))
    return f"{format_time(sunset_elev_friday - s.candle_lighting_minutes / 1440)}\nשקיעה{NBSP}{format_time(sunset_elev_friday)}"
