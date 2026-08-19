"""Which weeks there are to look at, and which one is "this" one.

A week is a thing the program shows, not a thing it stores: the saved sheets are the record,
and this is the index over them.
"""
from datetime import date

from .engine.hebrew_calendar import jewish_date_string
from .engine.solar import date_from_serial
from .state import week_objects


def week_index(state: dict):
    """Every week worth showing, keyed by its Shabbos serial.

    Newest sheet first, so a week appearing in more than one saved sheet resolves to the
    most recently generated one. The Shabbos sheets are walked before the Weekday charts, so
    a week that has both comes back with its Shabbos sheet; a week that only a Weekday chart
    covers comes back with none, which is a real case: that week's Shabbos is Yom Tov and has
    no parsha, so no Shabbos chart has a row for it, while its weekday times are still real.
    """
    sheets = sorted(state.get("sheets") or [], key=lambda s: str(s.get("createdAt") or ""), reverse=True)
    found = {}
    for wanted_weekday in (False, True):
        for sheet in sheets:
            if (sheet["season"] == "weekday") != wanted_weekday:
                continue
            for week in week_objects(sheet["weeks"]):
                found.setdefault(week.serial, (week, None if wanted_weekday else sheet))
    return dict(sorted(found.items()))


def weekday_chart_for(sheet, serial: int, state: dict):
    """The Weekday chart holding a week, whether it came in beside a Shabbos sheet or is the
    only chart that has the week at all."""
    sheets = state.get("sheets") or []
    if sheet:
        return next((s for s in sheets if s["season"] == "weekday" and s.get("linkedSheetId") == sheet["id"]), None)
    return next((s for s in sheets if s["season"] == "weekday"
                 and any(int(w["serial"]) == serial for w in s["weeks"])), None)


def current_serial(serials, today: date | None = None) -> int:
    """The week to open on: the next Shabbos still to come.

    It rolls over once Shabbos is behind us, so Sunday morning already shows the coming
    week. Compared as a date rather than a moment, so the switch happens at midnight on
    Motzei Shabbos rather than at an exact tzais.
    """
    if not serials:
        raise ValueError("no weeks")
    today = today or date.today()
    upcoming = [s for s in serials if date_from_serial(s) >= today]
    return min(upcoming) if upcoming else max(serials)


def shabbos_date_line(serial: int, settings) -> tuple:
    """The date above the buttons, in both calendars.

    "Shabbos" is written in rather than formatted: every week here is anchored on its
    Shabbos, so the day name is always Saturday and there is no reason to call it that on a
    shul's own page, and no locale has the word.
    """
    d = date_from_serial(serial)
    english = f"Shabbos, {d.strftime('%B')} {d.day}, {d.year}"
    return english, jewish_date_string(serial, False, settings.use_gregorian_before_1582)
