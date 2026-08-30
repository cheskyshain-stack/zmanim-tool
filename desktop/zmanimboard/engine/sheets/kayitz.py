"""שבת קיץ column formulas, ported from js/sheets/kayitz.js, itself a 1:1 port of the
workbook's SUMMER_ZMANIM_1 table, columns B to L.

week.serial is the Shabbos (Saturday) Excel serial; Friday anchored columns use it minus
one.
"""
from .. import zmanim as Z
from ..fmt import ceil_to_minute, floor_to_minute, format_time, underline_time
from ..hebrew_calendar import hebrew_date_extended
from ..solar import date_from_serial
from ..util import NBSP, SLASH
from .common import candle_lighting_cell, friday_main_mincha_menu, in_plag_window, shabbos_mincha_menu, shacharis_line

KAYITZ_COLUMNS = [
    ("B", "מעריב"),
    ("C", "מנחה"),
    ("D", 'ס"ז קר"ש\nגר״א / מ״א'),
    ("E", "שחרית"),
    ("F", " מעריב "),
    ("G", "מנחה\nמעריב"),
    ("H", "הדלקת\nנרות"),
    # I and J are both פלג מ"א; the difference is the tzais the day is measured to, 72
    # minutes here and 50 in J. The "72" says which is which and sits after פלג מ"א on its
    # own line, matching the printed board.
    ("I", "מנחה\n(בעזר״נ)\nפלג מ\"א 72"),
    ("J", "מנחה\n(למטה)\nפלג מ\"א"),
    ("K", "מנחה\nפלג גר\"א"),
    ("L", "מנחה\nערב שבת"),
]


def _in_extra_maariv_window(serial: float, s) -> bool:
    """AND(dayOfYear > 16, dayOfYear < 65): roughly the Sefirah stretch, after Pesach and
    before Shavuos, where the workbook adds a few minutes to the Friday Maariv and offers
    a second, later one."""
    doy = hebrew_date_extended(serial, s.use_gregorian_before_1582).day_of_year
    return 16 < doy < 65


def build_kayitz_row(week, s) -> dict:
    shabbos = week.serial
    friday = shabbos - 1
    shabbos_date = date_from_serial(shabbos)
    friday_date = date_from_serial(friday)

    row = {}
    row["B"] = f"{format_time(ceil_to_minute(Z.tzais_60(shabbos_date, s)))}{SLASH}{underline_time(ceil_to_minute(Z.tzais_72(shabbos_date, s)))}"
    row["C"] = shabbos_mincha_menu(shabbos_date, s)
    row["D"] = f"{format_time(Z.sof_zman_shma_mga_72(shabbos_date, s))}{SLASH}{format_time(Z.sof_zman_shma_gra(shabbos_date, s))}"
    row["E"] = shacharis_line()

    extra_maariv = _in_extra_maariv_window(friday, s)
    sunset_friday = Z.sunset(friday_date, s)
    row["F"] = underline_time(floor_to_minute(sunset_friday + (55 if extra_maariv else 50) / 1440))

    g_base = floor_to_minute(sunset_friday - 15 / 1440)
    row["G"] = format_time(g_base) + (f"\nמעריב{NBSP}{format_time(floor_to_minute(sunset_friday + 30 / 1440))}" if extra_maariv else "")

    row["H"] = candle_lighting_cell(friday_date, s)

    plag_window = in_plag_window(friday, s)
    plag_ma = Z.plag_hamincha_custom(Z.tzais_72(friday_date, s), Z.alos_16_1(friday_date, s))
    row["I"] = f"{format_time(ceil_to_minute(plag_ma - 15 / 1440))}\nפלג{NBSP}{format_time(ceil_to_minute(plag_ma))}" if plag_window else ""

    plag_ma2 = Z.plag_hamincha_custom(Z.tzais_50(friday_date, s), Z.alos_16_1(friday_date, s))
    row["J"] = f"{underline_time(ceil_to_minute(plag_ma2 - 15 / 1440))}\nפלג{NBSP}{format_time(ceil_to_minute(plag_ma2))}" if plag_window else ""

    plag_gra = Z.plag_hamincha(friday_date, s)
    row["K"] = f"{format_time(ceil_to_minute(plag_gra - 15 / 1440))}\nפלג{NBSP}{format_time(ceil_to_minute(plag_gra))}" if plag_window else ""

    row["L"] = friday_main_mincha_menu(friday_date, s)
    return row
