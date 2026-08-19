"""Season boundaries and week lists, ported from js/sheets/weeks.js.

Which Shabbosim belong on a קיץ or חורף chart for a given Hebrew year, mirroring the
workbook's own P5 formula but without needing a manually entered start date or week count.
"""
import math
import re
from dataclasses import dataclass
from datetime import date

from ..hebrew_calendar import (
    date_from_hebrew,
    excel_weekday,
    has_parsha,
    has_special_parsha,
    has_yom_tov,
    hebrew_date_extended,
    is_yom_tov_or_chol_hamoed,
)
from ..solar import date_from_serial, excel_serial
from .common import in_spring_dst_window

MAX_WEEKS = 60  # a safety cap, well above any real season's length


@dataclass(frozen=True)
class Week:
    serial: int
    date: date
    parsha: str
    special_parsha: str


@dataclass(frozen=True)
class SeasonWeeks:
    start_serial: int
    end_serial: int
    weeks: list


def season_start_serial(season: str, hebrew_year: int) -> int:
    """קיץ(Y) opens at Pesach(Y); חורף(Y) opens at Sukkos(Y)."""
    return date_from_hebrew(15, 1, hebrew_year) if season == "kayitz" else date_from_hebrew(15, 7, hebrew_year)


def season_end_serial(season: str, hebrew_year: int) -> int:
    """קיץ(Y) closes at Sukkos(Y+1); חורף(Y) closes at Pesach(Y), both inside AM year Y."""
    return date_from_hebrew(15, 7, hebrew_year + 1) if season == "kayitz" else date_from_hebrew(15, 1, hebrew_year)


def _first_saturday_on_or_after(serial: float) -> int:
    d = math.ceil(serial)
    while excel_weekday(d) != 7:
        d += 1
    return d


def compute_season_weeks(season: str, hebrew_year: int, s, tables) -> SeasonWeeks:
    start_serial = season_start_serial(season, hebrew_year)
    end_serial = season_end_serial(season, hebrew_year)

    d = _first_saturday_on_or_after(start_serial)
    weeks, guard = [], 0
    while d <= end_serial and guard < MAX_WEEKS:
        parsha = has_parsha(d, s, tables)
        if parsha:
            weeks.append(Week(d, date_from_serial(d), parsha, has_special_parsha(d, s)))
        d += 7
        guard += 1
    return SeasonWeeks(start_serial, end_serial, weeks)


_CHOL_HAMOED_ANCHOR = re.compile(r"Chol Hamoed|חול המועד|Hoshana Rabbah|הושענה רבה")


def _is_chol_hamoed_anchor(day: int, s, special_days_table) -> bool:
    return bool(_CHOL_HAMOED_ANCHOR.search(has_yom_tov(day, s, special_days_table)))


def _any_regular_day(from_serial: int, to_serial: int, s, special_days_table) -> bool:
    return any(not is_yom_tov_or_chol_hamoed(day, s, special_days_table) for day in range(from_serial, to_serial + 1))


def _holiday_name_for(day: int, s, special_days_table) -> str:
    """"Chol Hamoed Pesach" or "הושענה רבה" to the plain holiday name, for the Chol Hamoed
    row below: it stands in for the holiday as a whole rather than for one of its days."""
    name = has_yom_tov(day, s, special_days_table)
    if re.fullmatch(r"Hoshana Rabbah|הושענה רבה", name):
        return "סוכות" if re.search(r"[֐-׿]", name) else "Succos"
    return re.sub(r"^(Chol Hamoed |חול המועד )", "", name)


def compute_weekday_weeks(season: str, hebrew_year: int, s, tables) -> SeasonWeeks:
    """The Weekday chart's own week list, over the same season range but with a different
    inclusion rule: a week counts as long as at least one of its Sunday to Friday days, the
    days a Weekday chart actually schedules, is a normal day.

    That is a superset of the Shabbos chart's list. A week whose Shabbos falls on Yom Tov
    has no parsha and is excluded there, but can still need a Weekday row if only its
    Thursday and Friday are Yom Tov and the rest are ordinary days. Each week is still
    anchored to its Shabbos, and the label falls back to that Shabbos's Yom Tov name when
    there is no parsha to name the row with.

    Season boundaries essentially never line up with the fixed seven day Saturday spacing,
    which leaves a stretch of up to six regular days between the last Saturday anchored
    week and the boundary itself, the days between שבת הגדול and ליל פסח for instance. The
    trailing gap check folds that onto the outgoing season as one more row, per "a week
    falling between two charts belongs to the earlier one".

    A Saturday landing on Chol Hamoed is excluded from the incoming season's own loop, its
    backward window otherwise mixing genuine pre-Yom-Tov days already claimed by the
    outgoing chart with actual Chol Hamoed days. It is not dropped: the check after the
    loop folds it onto the outgoing chart, named for the holiday.
    """
    start_serial = season_start_serial(season, hebrew_year)
    end_serial = season_end_serial(season, hebrew_year)

    d = _first_saturday_on_or_after(start_serial)
    weeks, guard = [], 0
    while d <= end_serial and guard < MAX_WEEKS:
        # d == start_serial: the season's own start boundary landed exactly on Shabbos, so
        # its backward attached weekdays are still the outgoing season's territory, already
        # covered by its trailing gap row. Without this both seasons print the same row.
        is_own_start_boundary = d == start_serial
        if (
            not is_own_start_boundary
            and not _is_chol_hamoed_anchor(d, s, tables.special_days)
            and _any_regular_day(d - 6, d - 1, s, tables.special_days)
        ):
            parsha = has_parsha(d, s, tables) or has_yom_tov(d, s, tables.special_days)
            weeks.append(Week(d, date_from_serial(d), parsha, has_special_parsha(d, s)))
        d += 7
        guard += 1

    # The trailing gap: the regular days, if any, between the last Saturday anchored week
    # and the season's end boundary. Anchored at end_serial itself, which is a stand-in
    # date rather than a real Shabbos, and named for whatever Yom Tov starts there. When
    # the boundary was exactly Shabbos the loop already took it and this comes out empty.
    gap_start = d - 7 + 1
    gap_end = end_serial - 1
    if gap_start <= gap_end and _any_regular_day(gap_start, gap_end, s, tables.special_days):
        parsha = has_parsha(end_serial, s, tables) or has_yom_tov(end_serial, s, tables.special_days)
        weeks.append(Week(end_serial, date_from_serial(end_serial), parsha, has_special_parsha(end_serial, s)))

    # d is now the first Saturday after the boundary, which is exactly the date the
    # incoming season's own loop would land on as its first candidate. A Chol Hamoed
    # Shabbos there becomes a row here instead of there. It is folded into the trailing gap
    # row above rather than added separately whenever that row already carries the same
    # holiday's name: the two stretches are the run-up to, and the middle of, one Yom Tov,
    # so the chart carries one row for it rather than a pair of identical ones.
    chol_hamoed_name = _holiday_name_for(d, s, tables.special_days) if _is_chol_hamoed_anchor(d, s, tables.special_days) else ""
    if chol_hamoed_name and (not weeks or weeks[-1].parsha != chol_hamoed_name):
        weeks.append(Week(d, date_from_serial(d), chol_hamoed_name, ""))

    return SeasonWeeks(start_serial, end_serial, weeks)


def split_choref_at_spring_cutover(weeks, s) -> int:
    """Where a שבת חורף season's weeks cross the spring DST cutover, the second Sunday of
    March, not the autumn one near the season's start. From that week on the season needs
    an actual שבת קיץ chart: the shul still davens on a summer schedule through Pesach once
    the clock springs forward. Returns len(weeks) if the whole season is before it, which
    should not happen in practice, Pesach always falling after the second Sunday of March.
    """
    for i, w in enumerate(weeks):
        if in_spring_dst_window(w.date, s):
            return i
    return len(weeks)


def next_available_year_for(season: str, s, today_serial: int | None = None) -> int:
    """The smallest Hebrew year for this season whose range has not fully elapsed, so the
    Generate form's year field never defaults to a season already over."""
    today = excel_serial(date.today()) if today_serial is None else today_serial
    y = hebrew_date_extended(today, s.use_gregorian_before_1582).year - 1
    for _ in range(6):
        if season_end_serial(season, y) >= today:
            break
        y += 1
    return y


def default_season_and_year(s, today_serial: int | None = None):
    """Which season and year Generate should open on: the next season chronologically
    after whichever contains today. A schedule is always prepared ahead of time for the
    coming season, never the one in progress and never one already over."""
    today = excel_serial(date.today()) if today_serial is None else today_serial
    y0 = hebrew_date_extended(today, s.use_gregorian_before_1582).year
    sukkos_y0 = date_from_hebrew(15, 7, y0)
    pesach_y0 = date_from_hebrew(15, 1, y0)
    sukkos_y0_plus_1 = date_from_hebrew(15, 7, y0 + 1)

    if today < sukkos_y0:
        current_season, current_year = "kayitz", y0 - 1  # still in last cycle's קיץ
    elif today < pesach_y0:
        current_season, current_year = "choref", y0
    elif today < sukkos_y0_plus_1:
        current_season, current_year = "kayitz", y0
    else:
        current_season, current_year = "choref", y0 + 1

    if current_season == "choref":
        return "kayitz", current_year
    return "choref", current_year + 1
