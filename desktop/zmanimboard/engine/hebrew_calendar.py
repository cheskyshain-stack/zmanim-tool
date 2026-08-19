"""Hebrew calendar engine, ported from js/hebrew-calendar.js, which is a 1:1 port of the
workbook's own defined names (ROSH_HASHANA, JEWISH_DATE_AS_ARRAY_EXTENDED,
GET_DATE_FROM_JEWISH_DATE_ARRAY, HAS_PARSHA, HAS_SPECIAL_PARSHA, HAS_YOM_TOV,
HAS_ROSH_CHODESH, HAS_BEHAB, HAS_TAANIS).

Entirely self contained, with no calendar library, so the results match the workbook
exactly, including its own particular special-Shabbos day-of-year definitions.

Month numbering is the workbook's, which is the Torah's: Nissan is 1 through Adar 12,
with Adar I 13 and Adar II 14 in a leap year.
"""
import math
import re
from dataclasses import dataclass

from .jsmath import at, js_trunc, mod


def excel_weekday(serial: float) -> int:
    """Excel WEEKDAY in its default mode: 1 is Sunday through 7 is Saturday."""
    return int(mod(math.floor(serial) - 1, 7)) + 1


JEWISH_MONTHS_HE = ["ניסן", "אייר", "סיון", "תמוז", "אב", "אלול", "תשרי", "חשון", "כסלו", "טבת", "שבט", "אדר", "אדר א׳", "אדר ב׳"]
JEWISH_MONTHS_EN = ["Nissan", "Iyar", "Sivan", "Tammuz", "Av", "Elul", "Tishrei", "Cheshvan", "Kislev", "Teves", "Shevat", "Adar", "Adar I", "Adar II"]


def rosh_hashana(x: int) -> int:
    """ROSH_HASHANA(x): the molad based date of Rosh Hashana for AM year x + 3761, with
    all four dechiyos baked into the arithmetic. Returns an Excel serial."""
    year = x + 3761
    molad = 57444 + 9185196 * (year - 1) + 765433 * math.floor((year * 7 - 6) / 19)
    molad_mod = mod(molad, 181440)
    t1 = math.floor(molad / 25920 + 0.25)
    t2 = mod(math.floor(mod(molad / 25920 - 2.75, 7)), 2)
    t3 = 2 if mod(year * 7 + 1, 19) > 6 and 87684 <= molad_mod < 97200 else 0
    t4 = 1 if mod((year - 1) * 7 + 1, 19) < 7 and 68629 <= molad_mod < 71280 else 0
    return int(t1 + t2 + t3 + t4 - 2067023)


def _year_eternal(serial: float, use_gregorian_before_1582: bool) -> int:
    """YEAR_ETERNAL: the proleptic Gregorian year for an Excel serial."""
    i = math.floor(serial)
    a = math.floor((i + 547803) / 36524.25)
    gregorian_correction = use_gregorian_before_1582 or i > -115859
    b = i + (a + 1 - math.floor(a / 4) if gregorian_correction else 0) + 1510
    c = math.floor((b - 122.1) / 365.25)
    return int(c + 1897 - (1 if math.floor((b - math.floor(365.25 * c)) / 30.6) < 14 else 0))


@dataclass(frozen=True)
class HebrewDate:
    day_of_month: int
    month: int
    year: int
    day_of_year: int
    leap: bool
    year_type: int
    rosh_hashana: int
    year_length: int


def hebrew_date_extended(serial: float, use_gregorian_before_1582: bool = False) -> HebrewDate:
    """JEWISH_DATE_AS_ARRAY_EXTENDED: the full breakdown for an Excel serial."""
    d_serial = math.floor(serial)
    y_eternal = _year_eternal(d_serial, use_gregorian_before_1582)
    year = y_eternal + 3760 + (1 if rosh_hashana(y_eternal) <= d_serial else 0)
    rh = rosh_hashana(year - 3761)
    year_length = rosh_hashana(year - 3760) - rh
    date_after_rh = d_serial - rh + 1
    year_type = int(mod(year_length, 10))
    leap = mod(7 * year + 1, 19) < 7
    d = mod(date_after_rh + 176, year_length) + 1
    if year_type == 3 and d > 265:
        day_of_year = d + 1
    elif year_type == 5:
        day_of_year = d - 1 if d > 237 else (0 if d == 237 else d)
    else:
        day_of_year = d
    if day_of_year == 0:
        month, day_of_month = 8, 30
    elif day_of_year >= 326 and leap:
        month = math.floor((day_of_year - 31) / 29.5) + 3
        day_of_month = math.floor(mod(day_of_year - 31, 29.5)) + 1
    else:
        month = math.floor((day_of_year - 1) / 29.5) + 1
        day_of_month = math.floor(mod(day_of_year - 1, 29.5)) + 1
    return HebrewDate(int(day_of_month), int(month), int(year), int(day_of_year), bool(leap), year_type, rh, int(year_length))


def date_from_hebrew(day: int, month: int, year: int) -> int:
    """GET_DATE_FROM_JEWISH_DATE_ARRAY: Hebrew day, month and AM year to an Excel serial."""
    leap = mod((year - 1) * 7 + 1, 19) < 7
    year_length = rosh_hashana(year - 3760) - rosh_hashana(year - 3761)
    year_type = mod(year_length, 10)
    month_term = math.floor((month - 2) * 29.5 + 1) if leap and month >= 12 else math.floor(month * 29.5 - 29)
    adj = 0
    if year_type == 3 and month >= 10:
        adj = -1
    elif year_type == 5 and month >= 9:
        adj = 1
    total = -177 + month_term + adj + (day - 1)
    return int(rosh_hashana(year - 3761) + mod(total, year_length))


def _hebrew_number(n: int) -> str:
    """__HEBREW_NUMBER, simplified to the numerals actually needed here."""
    ones = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"]
    tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"]
    hundreds = ["", "ק", "ר", "ש", "ת"]
    num, out = n, ""
    while num >= 400:
        out += "ת"
        num -= 400
    out += hundreds[num // 100]
    num %= 100
    out += tens[num // 10]
    num %= 10
    out += ones[num]
    # First occurrence only, matching JavaScript's String.replace with a string argument.
    # Python's str.replace would take every one.
    out = out.replace("יה", "טו", 1).replace("יו", "טז", 1)
    return out + "׳" if len(out) <= 1 else out[:-1] + "״" + out[-1]


def _hebrew_year(year: int) -> str:
    """A year in לפרט קטן, the way one is written: the thousands are left off, so 5786 is
    תשפ"ו. Spelled in full it would open with fourteen ת's, the numerals having no letter
    past 400, which is exactly what this used to print."""
    small = year % 1000
    return _hebrew_number(small or year)


# The holiday names that stand in for a parsha on a Shabbos that has none.
#
# A week is named for the parsha read on its Shabbos, and when that Shabbos is Yom Tov
# there is none, so the week carries the Yom Tov's name instead. Printed as it stands,
# "סוכות" reads as though the row held the times for Yom Tov; it holds the ordinary
# weekdays around it. This is how a renderer tells the two apart so it can say
# "שבוע של סוכות".
#
# Derived rather than guessed: every parsha-less Shabbos over forty years, in Hebrew and
# English and in Israel and out, produces exactly these seven names each way.
YOM_TOV_WEEK_LABELS = [
    "פסח", "שבועות", "ראש השנה", "יום כפור", "סוכות", "שמיני עצרת", "שמחת תורה",
    "Pesach", "Shavuos", "Rosh Hashana", "Yom Kippur", "Succos", "Shemini Atzeres", "Simchas Torah",
]


def is_yom_tov_week_label(label) -> bool:
    return str(label or "").strip() in YOM_TOV_WEEK_LABELS


def week_of_label(label, english: bool) -> str:
    """How such a week is named: "שבוע של סוכות" or "Week of Succos". Anything else comes
    back untouched, so a caller can hand it any week label."""
    if is_yom_tov_week_label(label):
        return ("Week of " if english else "שבוע של ") + str(label).strip()
    return label


def jewish_date_string(serial: float, english: bool, use_gregorian_before_1582: bool = False) -> str:
    j = hebrew_date_extended(serial, use_gregorian_before_1582)
    month_name = (JEWISH_MONTHS_EN if english else JEWISH_MONTHS_HE)[j.month - 1]
    if english:
        return f"{j.day_of_month} {month_name}, {j.year}"
    return f"{_hebrew_number(j.day_of_month)} {month_name}, {_hebrew_year(j.year)}"


def has_parsha(serial: float, s, tables) -> str:
    """HAS_PARSHA: the parsha read on the Shabbos containing this serial.

    Empty for any day that is not a Saturday, and for a Yom Tov Shabbos, which has no
    parsha read. That empty return is exactly the signal the season week list uses to
    skip Yom Tov weeks.
    """
    if excel_weekday(serial) != 7:
        return ""
    j = hebrew_date_extended(serial, s.use_gregorian_before_1582)
    rh = rosh_hashana(j.year - 3761)
    rhdow = int(mod(rh - 1, 7)) + 1
    year_type_key = f"{rhdow}{j.year_type}{'M' if j.leap else 'P'}"
    table = tables.parsha_ey if s.in_israel else tables.parsha_chutz
    if year_type_key not in table["headers"]:
        return ""
    parsha_col = table["headers"].index(year_type_key)
    parsha_row = js_trunc((serial - rh + rhdow) / 7)
    row_values = at(table["rows"], parsha_row - 1)
    if row_values is None:
        return ""
    parsha_num = row_values[parsha_col]
    if not isinstance(parsha_num, (int, float)) or isinstance(parsha_num, bool):
        return ""
    names_row = at(tables.parsha_names["rows"], int(parsha_num) - 1)
    if names_row is None:
        return ""
    return names_row[1] if s.english else names_row[0]


def has_special_parsha(serial: float, s) -> str:
    """HAS_SPECIAL_PARSHA: the named special Shabbosim, by exact Hebrew day of year,
    hardcoded exactly as the workbook has them."""
    if excel_weekday(serial) != 7:
        return ""
    j = hebrew_date_extended(serial, s.use_gregorian_before_1582)
    d = j.day_of_year
    doy = (0 if d < 345 else d - 30) if (j.leap and d > 315) else d
    en = s.english
    if doy in (180, 182, 183, 185):
        return "Shuva" if en else "שובה"
    if (doy == 305 and j.year_type == 5) or (doy == 312 and j.year_type == 3) or doy in (306, 307, 308, 310):
        return "Shira" if en else "שירה"
    if doy in (320, 322, 324, 326):
        return "Shekalim" if en else "שקלים"
    if doy in (333, 334, 336, 338):
        return "Zachor" if en else "זכור"
    if doy in (343, 345, 347, 348):
        return "Parah" if en else "פרה"
    if doy in (350, 352, 354, 1):
        return "Hachodesh" if en else "החדש"
    if doy in (8, 10, 12, 14):
        return "Hagadol" if en else "הגדול"
    if doy in (122, 124, 126, 127):
        return "Chazon" if en else "חזון"
    if doy in (129, 131, 133, 134):
        return "Nachamu" if en else "נחמו"
    return ""


def has_yom_tov(serial: float, s, special_days_table) -> str:
    """HAS_YOM_TOV, via the workbook's SPECIAL_DAYS_TABLE."""
    j = hebrew_date_extended(serial, s.use_gregorian_before_1582)
    doy = j.day_of_year
    if doy in (267, 268, 269) and j.year_type == 3:
        doy -= 1  # the first three days of Teves, Chanukah in a chaser year
    row = next((r for r in special_days_table["rows"] if r[0] == doy), None)
    if row is None:
        return ""
    col = 1 + (1 if j.leap else 0) + (2 if s.in_israel else 0) + (0 if s.english else 4)
    return row[col] or ""


def is_assur_melacha(serial: float, s) -> bool:
    """IS_ASSUR_MELACHA: Shabbos or any full Yom Tov day, but not Chol Hamoed."""
    if excel_weekday(serial) == 7:
        return True
    j = hebrew_date_extended(serial, s.use_gregorian_before_1582)
    days = [21, 65, 178, 179, 187, 192, 199] + ([15] if s.in_israel else [15, 16, 22, 66, 193, 200])
    return j.day_of_year in days


_CHOL_HAMOED = re.compile(r"Chol Hamoed|חול המועד|Hoshana Rabbah|הושענה רבה")


def is_yom_tov_or_chol_hamoed(serial: float, s, special_days_table) -> bool:
    """A weekday whose davening would not follow the shul's regular weekday schedule.

    Deliberately not true for Chanukah, Purim, Tu B'Shvat and the like: davening on those
    is still the regular weekday schedule with a paragraph added, so they still count as a
    normal day for the Weekday chart's week inclusion rule.
    """
    if is_assur_melacha(serial, s):
        return True
    return bool(_CHOL_HAMOED.search(has_yom_tov(serial, s, special_days_table)))


def has_rosh_chodesh(serial: float, s) -> str:
    """HAS_ROSH_CHODESH, including the workbook's two quirks: 1 Tishrei is excluded, that
    day being Rosh Hashana rather than Rosh Chodesh, and the 30th of a full month is the
    first day of the next month's Rosh Chodesh, so it is named for the month starting. In
    a leap year the month after Shevat is Adar I, hence the extra step."""
    j = hebrew_date_extended(serial, s.use_gregorian_before_1582)
    months = JEWISH_MONTHS_EN if s.english else JEWISH_MONTHS_HE
    label = "Rosh Chodesh " if s.english else "ראש חדש "
    if j.day_of_month == 1 and j.month != 7:
        return label + months[j.month - 1]
    if j.day_of_month == 30:
        return label + months[j.month + (2 if j.leap and j.month == 11 else 1) - 1]
    return ""


def has_behab(serial: float, s) -> str:
    """HAS_BEHAB: the Monday, Thursday and Monday after Rosh Chodesh Iyar and Cheshvan.

    The workbook expresses the custom as day of month windows rather than as "the first
    Monday after": Iyar or Cheshvan only, a Monday between the 4th and the 17th, a
    Thursday between the 7th and the 13th. Each window holds exactly the intended days.
    """
    j = hebrew_date_extended(serial, s.use_gregorian_before_1582)
    if j.month not in (2, 8):
        return ""
    weekday = excel_weekday(serial)
    label = "BeHaB" if s.english else "בה״ב"
    if weekday == 2 and 4 <= j.day_of_month <= 17:
        return label
    if weekday == 5 and 7 <= j.day_of_month <= 13:
        return label
    return ""


def has_taanis(serial: float, s) -> str:
    """HAS_TAANIS, deferrals included: a fast that would fall on Shabbos moves to Sunday,
    except תענית אסתר which moves back to the Thursday before. Asara B'Teves can never
    fall on Shabbos and so has no deferral. Yom Kippur is here because the workbook counts
    it among the fasts."""
    j = hebrew_date_extended(serial, s.use_gregorian_before_1582)
    weekday = excel_weekday(serial)
    en = s.english
    d = j.day_of_month
    name = {
        "tammuz": "Seventeenth of Tammuz" if en else "שבעה עשר בתמוז",
        "av": "Tishah B'Av" if en else "תשעה באב",
        "gedalyah": "Fast of Gedalyah" if en else "צום גדליה",
        "kippur": "Yom Kippur" if en else "יום כפור",
        "teves": "Tenth of Teves" if en else "עשרה בטבת",
        "esther": "Fast of Esther" if en else "תענית אסתר",
    }
    if j.month == 4:
        if d == 17 and weekday != 7:
            return name["tammuz"]
        if d == 18 and weekday == 1:
            return name["tammuz"]
        return ""
    if j.month == 5:
        if d == 9 and weekday != 7:
            return name["av"]
        if d == 10 and weekday == 1:
            return name["av"]
        return ""
    if j.month == 7:
        if d == 3 and weekday != 7:
            return name["gedalyah"]
        if d == 4 and weekday == 1:
            return name["gedalyah"]
        if d == 10:
            return name["kippur"]
        return ""
    if j.month == 10:
        return name["teves"] if d == 10 else ""
    if j.month in (12, 14):
        if d == 13 and weekday != 7:
            return name["esther"]
        if d == 11 and weekday == 5:
            return name["esther"]
        return ""
    return ""
