"""The Weekday chart's מנחה and מעריב schedule, ported from js/sheets/weekday.js.

The שבת charts are 1:1 ports of workbook columns. These two are not: the workbook leaves
weekday מנחה and מעריב blank and they were typed in by hand every week. So the shul's
standing weekday schedule is written out here as the rules it actually follows, and every
zman those rules lean on still comes from the workbook's own ported formulas, never from a
zmanim library.

Everything is decided once per week, from Sunday through Thursday only: Friday runs on the
ערב שבת schedule over on the שבת chart, and Shabbos has its own.

שחרית is deliberately not built here. It is one fixed schedule, identical every week,
printed once as a merged cell straight from settings.

How a printed time says where that מנין davens, the same symbols the chart's footer
explains:

    plain time        main בית מדרש
    underlined time   למטה
    one * after it    בעזר״נ
    two ** after it   באולם השמחות
"""
import math

from .. import zmanim as Z
from ..fmt import format_time, underline_time
from ..hebrew_calendar import date_from_hebrew, excel_weekday, hebrew_date_extended
from ..solar import date_from_serial
from ..util import split_lines_in_half

WEEKDAY_COLUMNS = [("B", "מעריב"), ("C", "מנחה"), ("E", "שחרית")]

# Times are handled in whole minutes after midnight rather than day fractions, because
# every zman on this chart sits on a five minute grid and the moves below are defined in
# minutes. It also lets מעריב 12:00 be 1440, the end of the day, rather than 0, which
# would otherwise sort before everything else.
def _hm(h: int, m: int) -> int:
    return h * 60 + m


def _fmt_minutes(mins: float) -> str:
    return format_time(mins / 1440)


def _to_minutes(day_fraction: float) -> float:
    return day_fraction * 1440


STEP = 5        # a zman is nudged five minutes at a time
TOO_CLOSE = 14  # fourteen minutes or less from its neighbour and a moved zman is dropped
STEP_GUARD = 288  # 288 * 5 is a full day, so a bad latitude can never spin forever

MAIN = "main"    # main בית מדרש, printed plain
LMATA = "lmata"  # למטה, printed underlined
EZRAS = "ezras"  # בעזר״נ, printed with one star


def _render_time(mins: float, place: str) -> str:
    text = _fmt_minutes(mins)
    if place == LMATA:
        return underline_time(text)
    if place == EZRAS:
        return f"{text}*"
    return text


def _sunday_through_thursday(serial: int):
    """The five days this row schedules.

    Weekday rows are anchored on their Shabbos serial like every other row, so Sunday is
    six days back. Two rows on a Weekday chart are anchored on a stand-in date rather than
    a real Saturday (the season's trailing gap before Yom Tov, and a Chol Hamoed row),
    which is why this walks back from whatever weekday the serial actually is.
    """
    sunday = serial - (excel_weekday(serial) - 1)
    return [sunday + i for i in range(5)]


def _shkia_minutes(serial: int, s) -> float:
    return _to_minutes(Z.sunset(date_from_serial(serial), s))


# The three BMG זמנים, as Hebrew day and month pairs. Month numbering is the workbook's:
# Nissan 1 through Elul 6, Tishrei 7 through Adar 12. end_year_offset is 1 for the אלול
# range only, because its end, יום כיפור, falls after ראש השנה and so lands in the next AM
# year, while the other two open and close inside one.
BMG_RANGES = [
    ((1, 6), (10, 7), 1),  # ר"ח אלול to יום כיפור
    ((1, 8), (7, 1), 0),   # ר"ח חשון to ז' ניסן
    ((1, 2), (9, 5), 0),   # ר"ח אייר to ט' באב
]


def _is_bmg_day(serial: int, s) -> bool:
    """Whether one day falls inside a BMG זמן.

    Each range is resolved into actual serial dates so the comparison is a plain date
    range, which sidesteps the AM year rolling over at ראש השנה while the month numbering
    starts at ניסן. The neighbouring years are checked too: a day in תשרי belongs to a
    range that opened in אלול of the year before.
    """
    year = hebrew_date_extended(serial, s.use_gregorian_before_1582).year
    for y in (year - 1, year, year + 1):
        for (start, end, end_year_offset) in BMG_RANGES:
            frm = date_from_hebrew(start[0], start[1], y)
            to = date_from_hebrew(end[0], end[1], y + end_year_offset)
            if frm <= serial <= to:
                return True
    return False


def _is_bmg_week(serial: int, s) -> bool:
    """One answer for the whole row, the chart printing one line per week. A week
    straddling the start or end of a זמן goes with the majority of its Sunday to Thursday
    days, so a row can never come out self contradictory: a 4:15 מנחה, which is BMG only,
    printed beside an 11:30 מעריב, which is not."""
    days = _sunday_through_thursday(serial)
    return len([d for d in days if _is_bmg_day(d, s)]) * 2 > len(days)


def _mincha_times(week, s):
    """מנחה.

    Regular times: 12:45, 1:15, 1:35, 1:50, 4:15, 6:35, 7:30, 8:00. All למטה except 1:50,
    which is the main בית מדרש, and a zman that moves keeps the location it started with.
    """
    days = _sunday_through_thursday(week.serial)
    dates = [date_from_serial(d) for d in days]

    # 12:45 and 1:15 run on standard time only. DST always flips on a Sunday, so all five
    # days agree; all() is just being explicit about which way a split week would go.
    standard_time = all(not Z.dst_local(d, s) for d in dates)
    bmg = _is_bmg_week(week.serial, s)

    # 1:35 unless מנחה גדולה is too late for it anywhere in the week, in which case 1:40.
    # Never anything else. The workbook makes the same call the same way for its ערב שבת
    # menu, against the same MINCHA_GEDOLA_LECHUMRA.
    latest_mincha_gedola = max(_to_minutes(Z.mincha_gedola_lechumra(d, s)) for d in dates)
    early_afternoon = _hm(13, 40) if latest_mincha_gedola > _hm(13, 35) else _hm(13, 35)

    # The evening מנחה must clear שקיעה by fifteen minutes on every one of the five days,
    # so it is the *earliest* שקיעה that binds. Rounded down, so a stray fraction of a
    # minute can never leave a zman a few seconds short of the fifteen.
    earliest_shkia = math.floor(min(_shkia_minutes(d, s) for d in days))
    latest_allowed = earliest_shkia - 15

    slots = [slot for slot in [
        {"mins": _hm(12, 45), "place": LMATA} if standard_time else None,
        {"mins": _hm(13, 15), "place": LMATA} if standard_time else None,
        {"mins": early_afternoon, "place": LMATA},
        {"mins": _hm(13, 50), "place": MAIN},
        {"mins": _hm(16, 15), "place": LMATA} if bmg else None,  # 4:15 is a BMG zman
        {"mins": _hm(18, 35), "place": LMATA, "shkia_driven": True},
        {"mins": _hm(19, 30), "place": LMATA, "shkia_driven": True},
        {"mins": _hm(20, 0), "place": LMATA, "shkia_driven": True},
    ] if slot]

    # Walk each evening zman earlier, five minutes at a time, until it clears שקיעה.
    for slot in slots:
        if not slot.get("shkia_driven"):
            continue
        base = slot["mins"]
        guard = 0
        while slot["mins"] > latest_allowed and guard < STEP_GUARD:
            slot["mins"] -= STEP
            guard += 1
        slot["moved"] = slot["mins"] != base

    # A move can walk a zman back into the one before it. Once it is within fourteen
    # minutes of the previous מנחה still being printed, it stops being printed at all.
    kept = []
    for slot in slots:
        prev = kept[-1] if kept else None
        if slot.get("moved") and prev and slot["mins"] - prev["mins"] <= TOO_CLOSE:
            continue
        kept.append(slot)
    return [_render_time(slot["mins"], slot["place"]) for slot in kept]


def _place_845(mins: float) -> str:
    """Where the 8:45 מעריב davens, which follows wherever the clock pushed it to. It is
    still the 8:45 מנין at every one of these times."""
    if mins <= _hm(20, 45):
        return MAIN   # never moved: main בית מדרש
    if mins <= _hm(21, 15):
        return LMATA  # 8:50 through 9:15: למטה
    return EZRAS      # 9:20 or later: בעזר״נ


def _maariv_times(week, s):
    """מעריב.

    Regular times: 6:35, 7:00, 7:30, 8:00, 8:45, 9:30, 10:00, 10:30, 11:00, 11:30, 12:00.
    למטה throughout except 10:30, the main בית מדרש, and the 8:45 מנין, which moves around.
    11:30 and 12:00 run only when BMG is out of session.
    """
    days = _sunday_through_thursday(week.serial)
    bmg = _is_bmg_week(week.serial, s)

    # A מעריב must be fifty minutes after שקיעה on every one of the five days, so here it
    # is the *latest* שקיעה that binds. Rounded up, for the same reason מנחה rounds down.
    latest_shkia = math.ceil(max(_shkia_minutes(d, s) for d in days))
    earliest_allowed = latest_shkia + 50

    slots = [slot for slot in [
        {"mins": _hm(18, 35)},
        {"mins": _hm(19, 0)},
        {"mins": _hm(19, 30)},
        {"mins": _hm(20, 0)},
        {"mins": _hm(20, 45), "is_845": True},
        {"mins": _hm(21, 30)},
        {"mins": _hm(22, 0)},
        {"mins": _hm(22, 30), "place": MAIN},  # 10:30 is the main בית מדרש
        {"mins": _hm(23, 0)},
        {"mins": _hm(23, 30)} if not bmg else None,  # 11:30 and 12:00 run only when BMG is out
        {"mins": _hm(24, 0)} if not bmg else None,
    ] if slot]

    # Walk each zman later, five minutes at a time, until it clears שקיעה by fifty.
    for slot in slots:
        base = slot["mins"]
        guard = 0
        while slot["mins"] < earliest_allowed and guard < STEP_GUARD:
            slot["mins"] += STEP
            guard += 1
        slot["moved"] = slot["mins"] != base

    # The mirror of the מנחה rule, in the other direction: a zman pushed up to within
    # fourteen minutes of the next מעריב still being printed stops being printed. Walked
    # from the end backwards, so "the next one" means the next one actually surviving
    # rather than one that is itself about to be dropped.
    #
    # The 8:45 is exempt. It is a מנין in its own right rather than a duplicate of the one
    # behind it, and once it passes 9:20 it davens in a different room from the 9:30, so
    # the two belong on the board together. Without the exemption it would be deleted every
    # year from mid June to mid July, which is the only stretch where it ever reaches
    # בעזר״נ at all: the location rule above would never print once.
    kept = []
    for slot in reversed(slots):
        nxt = kept[-1] if kept else None
        if slot.get("moved") and not slot.get("is_845") and nxt and nxt["mins"] - slot["mins"] <= TOO_CLOSE:
            continue
        kept.append(slot)
    kept.reverse()
    return [_render_time(slot["mins"], _place_845(slot["mins"]) if slot.get("is_845") else slot.get("place") or LMATA) for slot in kept]


def build_weekday_row(week, s) -> dict:
    return {
        "B": split_lines_in_half(_maariv_times(week, s)),
        "C": split_lines_in_half(_mincha_times(week, s)),
    }
