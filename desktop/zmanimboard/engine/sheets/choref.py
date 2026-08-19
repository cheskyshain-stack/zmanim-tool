"""שבת חורף column formulas, ported from js/sheets/choref.js, itself a 1:1 port of the
workbook's WINTER_ZMANIM_1 table, columns B to I.
"""
from .. import zmanim as Z
from ..fmt import ceil_to_minute, floor_to_minute, format_time, underline_time
from ..solar import date_from_serial
from ..util import SLASH, textjoin
from .common import candle_lighting_cell, friday_main_mincha_menu, in_plag_window, shabbos_mincha_menu, shacharis_line

CHOREF_COLUMNS = [
    ("B", "מעריב"),
    ("C", "מנחה"),
    ("D", 'ס"ז קר"ש\nגר״א / מ״א'),
    ("E", "שחרית"),
    ("F", "מעריב"),
    ("G", "מנחה\nמעריב"),
    ("H", "הדלקת\nנרות"),
    ("I", "מנחה\nערב שבת"),
]


def build_choref_row(week, s) -> dict:
    shabbos = week.serial
    friday = shabbos - 1
    shabbos_date = date_from_serial(shabbos)
    friday_date = date_from_serial(friday)

    row = {}
    row["B"] = f"{format_time(ceil_to_minute(Z.tzais_60(shabbos_date, s)))}{SLASH}{underline_time(ceil_to_minute(Z.tzais_72(shabbos_date, s)))}"
    row["C"] = shabbos_mincha_menu(shabbos_date, s)
    row["D"] = f"{format_time(Z.sof_zman_shma_mga_72(shabbos_date, s))}{SLASH}{format_time(Z.sof_zman_shma_gra(shabbos_date, s))}"
    row["E"] = shacharis_line()

    sunset_friday = Z.sunset(friday_date, s)
    row["F"] = underline_time(floor_to_minute(sunset_friday + 50 / 1440))

    if in_plag_window(friday, s):
        row["G"] = textjoin(SLASH, True, [
            format_time(Z.plag_hamincha(friday_date, s) - 15 / 1440),
            format_time(Z.plag_hamincha_custom(Z.tzais_50(friday_date, s), Z.alos_16_1(friday_date, s)) - 15 / 1440),
            format_time(Z.plag_hamincha_custom(Z.tzais_72(friday_date, s), Z.alos_16_1(friday_date, s)) - 15 / 1440),
            format_time(floor_to_minute(sunset_friday - 15 / 1440)),
        ])
    else:
        row["G"] = format_time(floor_to_minute(sunset_friday - 15 / 1440))

    row["H"] = candle_lighting_cell(friday_date, s)
    row["I"] = friday_main_mincha_menu(friday_date, s)
    return row
