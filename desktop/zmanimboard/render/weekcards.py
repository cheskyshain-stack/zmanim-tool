"""Building a week's two cards: which rows go on them, in which order, and what each is
called.

Separate from the painting, so what goes on a card can be checked without drawing one.
"""
from ..engine.hebrew_calendar import (
    has_behab,
    has_rosh_chodesh,
    has_taanis,
    hebrew_date_extended,
    is_yom_tov_week_label,
    week_of_label,
)
from ..engine.sheets.choref import CHOREF_COLUMNS, build_choref_row
from ..engine.sheets.common import in_spring_dst_window
from ..engine.sheets.kayitz import KAYITZ_COLUMNS, build_kayitz_row
from ..engine.sheets.weekday import WEEKDAY_COLUMNS, build_weekday_row
from .card import CardLine, WeekCard

DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Shabbos"]


def special_days_in_week(shabbos_serial: int, s):
    """The ר"ח, בה"ב and תענית days in the week leading up to this Shabbos, named and with
    the day they fall on.

    A card is anchored on its Shabbos and the weekday times are for the days before it, so
    this walks Sunday through Friday. Grouped by name, so a two day ראש חודש reads
    "ראש חדש חשון (Sunday, Monday)" rather than naming the month twice.

    Yom Kippur and Tisha B'Av are skipped: those have their own schedule entirely, and
    listing them beside a regular שחרית time would be worse than saying nothing.
    """
    by_name = {}
    for offset in range(6, 0, -1):
        serial = shabbos_serial - offset
        day = DAY_NAMES[6 - offset]
        for name in (has_rosh_chodesh(serial, s), has_behab(serial, s), has_taanis(serial, s)):
            if not name:
                continue
            if any(x in name for x in ("יום כפור", "Yom Kippur", "תשעה באב", "Tishah")):
                continue
            by_name.setdefault(name, []).append(day)
    return [{"name": name, "day": ", ".join(days)} for name, days in by_name.items()]


def effective_season_for(week, season: str, s) -> str:
    return "kayitz" if season == "choref" and in_spring_dst_window(week.date, s) else season


def shabbos_card(week, season: str, s, raw_settings, rules=(), overrides=None) -> WeekCard | None:
    """The week's שבת card, or None when that Shabbos is Yom Tov and so has no chart row."""
    from ..engine.rules import apply_rules

    effective = effective_season_for(week, season, s)
    build, columns = (build_kayitz_row, KAYITZ_COLUMNS) if effective == "kayitz" else (build_choref_row, CHOREF_COLUMNS)
    row = build(week, s)
    if rules:
        hebrew = hebrew_date_extended(week.serial, s.use_gregorian_before_1582)
        row = apply_rules(row, week, rules, effective, hebrew)
    authored = (overrides or {}).get(week.serial, {})

    lines = []
    # Printed order, right to left, so the card lists the minyanim in the same sequence the
    # wall chart does.
    for key, header in reversed(columns):
        value = authored.get(key, row.get(key, ""))
        lines.append(CardLine(label=header, value=value, value_is_html=key in authored))
    return WeekCard(title=card_title(week), lines=lines, footer_address=raw_settings["footerAddress"])


def weekday_card(week, s, raw_settings, overrides=None) -> WeekCard:
    """The week's חול card."""
    row = build_weekday_row(week, s)
    authored = (overrides or {}).get(week.serial, {})
    lines = []
    for key, header in reversed(WEEKDAY_COLUMNS):
        if key == "E":
            # One fixed schedule for every week, straight from settings, as rich text.
            lines.append(CardLine(label=header, value=str(raw_settings["weekdayShacharis"] or "").strip(), value_is_html=True))
            continue
        # keep_empty: מנחה and מעריב hold their row even on a week that computes to nothing,
        # or the card reads as though the minyan does not exist rather than as though the
        # time is not set yet.
        value = authored.get(key, row.get(key, ""))
        lines.append(CardLine(label=header, value=value, value_is_html=key in authored, keep_empty=True))

    # The second שחרית schedule, only on weeks that actually have one of those days, and
    # labelled with which day it is rather than with the chart's catch-all heading. It goes
    # directly after the everyday schedule, not before it: most of the week still runs on
    # the regular times, so those are what should be read first.
    special = special_days_in_week(week.serial, s)
    if special and raw_settings.get("weekdayShacharisSpecial"):
        # The day names go on their own line, in their own direction. Run together with the
        # Hebrew they came out as "(Monday,)" on one line and "(Thursday" on the next: a
        # bracketed Latin list inside a right to left label is reordered when it wraps.
        label_html = "<br>".join(
            f"שחרית {d['name']}<br><span dir=\"ltr\">({d['day']})</span>" for d in special
        )
        lines.insert(1, CardLine(label="", value=str(raw_settings["weekdayShacharisSpecial"]).strip(),
                                 value_is_html=True, label_html=label_html))

    return WeekCard(title="זמני חול · " + card_title(week), lines=lines, is_weekday=True,
                    footer_address=raw_settings["footerAddress"])


def card_title(week) -> str:
    """A week whose Shabbos is Yom Tov is named for its Yom Tov rather than a parsha, no
    parsha being read that Shabbos. "פרשת סוכות" would be wrong, and "סוכות" on its own
    reads as though these were the times for Yom Tov, which they are not: they are the
    ordinary weekdays around it."""
    if is_yom_tov_week_label(week.parsha):
        return week_of_label(week.parsha, False)
    name = week.parsha + (" · " + week.special_parsha if week.special_parsha else "")
    return "פרשת " + name
