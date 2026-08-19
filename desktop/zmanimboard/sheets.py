"""Making a sheet, and turning a saved one back into printable pages.

A sheet is the record of one generation: which season and year, which weeks, how they split
across pages, and whatever has been typed over since. The times themselves are never stored.
They are recomputed from the formulas every time the sheet is opened, so a fix to a formula
reaches every sheet already made, and a hand typed cell stays a hand typed cell rather than
being baked into a wall of numbers.
"""
import time
import uuid
from datetime import datetime, timezone

from .engine import pagination as pag
from .engine.hebrew_calendar import hebrew_date_extended
from .engine.rules import apply_rules
from .engine.settings import DEFAULT_ACCENT_COLOR, SEASON_LABELS
from .engine.sheets.choref import CHOREF_COLUMNS, build_choref_row
from .engine.sheets.common import in_spring_dst_window
from .engine.sheets.kayitz import KAYITZ_COLUMNS, build_kayitz_row
from .engine.sheets.weekday import WEEKDAY_COLUMNS, build_weekday_row
from .engine.sheets.weeks import compute_season_weeks, compute_weekday_weeks
from .render.chart import ChartPage, Chrome, SheetStyle
from .state import week_objects, week_records


def new_id(prefix: str) -> str:
    return f"{prefix}-{int(time.time() * 1000):x}-{uuid.uuid4().hex[:6]}"


def generate(season: str, hebrew_year: int, page_sizes, settings, tables, raw_settings, include_weekday: bool = True):
    """One Shabbos sheet and, unless asked otherwise, the Weekday chart that goes with it.

    The two are generated together and stay a pair for the rest of their lives: the Weekday
    chart's page breaks are aligned onto the same dates as the Shabbos chart's, which is
    what makes the two pair up page by page when they print interleaved.
    """
    built = compute_season_weeks(season, hebrew_year, settings, tables)
    if not built.weeks:
        raise ValueError(f"{SEASON_LABELS.get(season, season)} {hebrew_year} has no weeks in it.")
    problem = pag.validate_page_sizes(len(built.weeks), page_sizes)
    if problem:
        raise ValueError(problem)

    created = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    style = dict(raw_settings.get("sheetStyle") or {"fontFamily": "Times New Roman", "fontSizePt": 10,
                                                   "headerScale": 1, "accentColor": DEFAULT_ACCENT_COLOR})
    sheet = {
        "id": new_id("sheet"),
        "createdAt": created,
        "season": season,
        "hebrewYear": hebrew_year,
        "weeks": week_records(built.weeks),
        "pageSizes": list(page_sizes),
        "overrides": {},
        "style": style,
        "columnWidths": {},
    }
    out = [sheet]

    if include_weekday:
        weekday = compute_weekday_weeks(season, hebrew_year, settings, tables)
        out.append({
            "id": new_id("sheet"),
            "createdAt": created,
            "season": "weekday",
            "hebrewYear": hebrew_year,
            "weeks": week_records(weekday.weeks),
            "pageSizes": pag.align_page_sizes_to(built.weeks, page_sizes, weekday.weeks),
            "overrides": {},
            "style": dict(style),
            "columnWidths": {},
            "linkedSheetId": sheet["id"],
            "linkedSeason": season,
        })
    return out


def companion_of(sheet: dict, sheets: list):
    """The Weekday chart generated with this sheet, or from a Weekday chart the Shabbos sheet
    it was made with. linkedSheetId is the pairing recorded at generation time; the season
    and year match after it is the fallback for pairs made before that was stored."""
    if sheet.get("season") == "weekday":
        by_id = next((s for s in sheets if s["id"] == sheet.get("linkedSheetId")), None)
        if by_id:
            return by_id
        candidates = [s for s in sheets if s["season"] == sheet.get("linkedSeason") and s["hebrewYear"] == sheet["hebrewYear"]]
    else:
        by_id = next((s for s in sheets if s["season"] == "weekday" and s.get("linkedSheetId") == sheet["id"]), None)
        if by_id:
            return by_id
        candidates = [s for s in sheets if s["season"] == "weekday" and s.get("linkedSeason") == sheet["season"]
                      and s["hebrewYear"] == sheet["hebrewYear"]]
    return max(candidates, key=lambda s: str(s.get("createdAt") or ""), default=None)


def effective_season(sheet: dict, page_weeks, settings) -> str:
    """Which chart a page really prints as.

    A שבת חורף page holding any week past the spring DST cutover comes out as a full שבת
    קיץ chart, same columns and same formulas, for that whole page, including earlier weeks
    on it, which simply come out with blank plag columns. The shul still davens on a summer
    schedule from the cutover through Pesach.
    """
    if sheet["season"] != "choref":
        return sheet["season"]
    return "kayitz" if any(in_spring_dst_window(w.date, settings) for w in page_weeks) else "choref"


def builder_for(season: str):
    if season == "weekday":
        return build_weekday_row, WEEKDAY_COLUMNS
    if season == "kayitz":
        return build_kayitz_row, KAYITZ_COLUMNS
    return build_choref_row, CHOREF_COLUMNS


def chart_pages(sheet: dict, state: dict, settings, merged_shacharis: str = "") -> list:
    """A saved sheet as printable pages, times and all, recomputed now.

    Rules are applied first and a hand typed override wins over both, which is the order the
    two are meant to work in: a rule is the shul's standing exception and reapplies every
    year, an override belongs to this one sheet.
    """
    weeks = week_objects(sheet["weeks"])
    pages = []
    for page_weeks in pag.split_weeks_into_pages(weeks, sheet["pageSizes"]):
        if not page_weeks:
            continue
        season = effective_season(sheet, page_weeks, settings)
        build, columns = builder_for(season)
        rows, authored, ruled = {}, {}, {}
        for week in page_weeks:
            row = build(week, settings)
            if season != "weekday":
                touched = set()
                hebrew = hebrew_date_extended(week.serial, settings.use_gregorian_before_1582)
                row = apply_rules(row, week, state.get("rules") or [], season, hebrew, touched)
                if touched:
                    ruled[week.serial] = touched
            typed = (sheet.get("overrides") or {}).get(str(week.serial)) or (sheet.get("overrides") or {}).get(week.serial) or {}
            if typed:
                row = {**row, **typed}
                authored[week.serial] = set(typed)
            rows[week.serial] = row
        pages.append(ChartPage(
            weeks=page_weeks, rows=rows, columns=columns, effective_season=season,
            authored=authored, ruled=ruled,
            shacharis_html=merged_shacharis if season == "weekday" else "",
        ))
    return pages


def week_cards(serial: int, state: dict, settings, raw_settings: dict, weekday_first: bool = False) -> list:
    """A week's two cards, built from the saved sheets exactly as the chart would show them:
    the formulas, then the rules, then anything typed over.

    A week whose Shabbos is Yom Tov has no parsha and so no row on any Shabbos chart. Its
    weekday times are still real, so it shows its חול card alone rather than being dropped.
    """
    from .render.weekcards import shabbos_card, weekday_card
    from .weeks import week_index, weekday_chart_for

    index = week_index(state)
    if serial not in index:
        return []
    week, sheet = index[serial]
    cards = []

    if sheet:
        overrides = _overrides_of(sheet)
        cards.append(shabbos_card(week, sheet["season"], settings, raw_settings,
                                  rules=state.get("rules") or [], overrides=overrides))

    weekday_sheet = weekday_chart_for(sheet, serial, state)
    if weekday_sheet:
        weekday_week = next((w for w in week_objects(weekday_sheet["weeks"]) if w.serial == serial), None)
        if weekday_week:
            cards.append(weekday_card(weekday_week, settings, raw_settings, overrides=_overrides_of(weekday_sheet)))

    # The two are ordered the same way on screen as on paper. This screen's whole bargain is
    # that what you see is what comes out, so an order that applied to the printer alone
    # would be a surprise waiting to happen.
    if weekday_first:
        cards.reverse()
    return cards


def _overrides_of(sheet: dict) -> dict:
    """A sheet's overrides keyed by serial as a number. JSON turns an object key into a
    string, so a file written here or exported from the web version has them as strings."""
    return {int(serial): cells for serial, cells in (sheet.get("overrides") or {}).items()}


def merged_shacharis_html(raw_settings: dict) -> str:
    """Both schedules as the wall chart has always shown them, with the heading between."""
    from .engine.settings import SPECIAL_SHACHARIS_HEADING

    schedule = str(raw_settings.get("weekdayShacharis") or "").replace("\n", "<br>")
    special = str(raw_settings.get("weekdayShacharisSpecial") or "").replace("\n", "<br>")
    if not special:
        return schedule
    return schedule + f"<br><br><u>{SPECIAL_SHACHARIS_HEADING}</u><br>" + special


def style_of(sheet: dict) -> SheetStyle:
    style = sheet.get("style") or {}
    return SheetStyle(
        font_family=style.get("fontFamily", "Times New Roman"),
        font_size_pt=float(style.get("fontSizePt", 10)),
        header_scale=float(style.get("headerScale", 1)),
        accent_color=style.get("accentColor") or DEFAULT_ACCENT_COLOR,
    )


def chrome_of(raw_settings: dict, weekday: bool = False) -> Chrome:
    return Chrome(
        shul_name=raw_settings.get("shulName", ""),
        header_subtitle=raw_settings.get("headerSubtitle", ""),
        header_rabbi_line=raw_settings.get("headerRabbiLine", ""),
        footer_note=raw_settings.get("weekdayFooterNote" if weekday else "footerNote", ""),
        footer_address=raw_settings.get("footerAddress", ""),
    )


def label_of(sheet: dict) -> str:
    return SEASON_LABELS.get(sheet.get("season"), sheet.get("season", ""))
