"""Everything the program remembers, in one file, in the same shape the web version uses.

That shape is not an accident and must not drift: the user has real data in the web
version, exported from Settings as a JSON backup, and this program has to open it and give
back the same sheets, the same hand typed cell overrides and the same rules. So the state
here is plain dicts and lists matching that JSON exactly, rather than a nicer model that
would need translating at both ends.

    {settings, sheets, rules, seeded}

A sheet's weeks carry an ISO date string, which is what JSON.stringify writes for a Date.
The engine wants a date object and a serial, so the two are converted at the edges: see
week_objects and week_records.
"""
import json
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from .engine.settings import (
    DEFAULT_ACCENT_COLOR,
    DEFAULT_SETTINGS,
    DEFAULT_WEEKDAY_SHACHARIS,
    resolve,
)
from .engine.sheets.weeks import Week
from .engine.solar import date_from_serial

STATE_FILE = "zmanim-state.json"

# Earlier shipped versions of the שחרית schedule and the weekday footer, from js/settings.js.
# A saved value still matching one of these verbatim was never edited by hand: it is an old
# default sitting in the file, so it is carried forward rather than left two versions
# behind. Anything else is left strictly alone.
LEGACY_WEEKDAY_SHACHARIS = [
    '7:00, 7:20*, 7:35\n8:00, 8:20*, 8:40\n\nר"ח בה"ב ותעני"צ\n6:40, 7:00*, 7:15,7:35**\n8:00, 8:20*, 8:40',
    '7:00, 7:20*, <u>7:35</u><br>8:00, 8:20*, <u>8:40</u><br><br><u>ר"ח בה"ב ותעני"צ</u><br>6:40, 7:00*, <u>7:15,7:35</u>**<br>8:00, 8:20*, <u>8:40</u>',
    '<span style="font-size:1.3em">7:00, 7:20*, <u>7:35</u><br>8:00, 8:20*, <u>8:40</u></span><br><br><u>ר"ח בה"ב ותעני"צ</u><br>6:40, 7:00*, <u>7:15,7:35</u>**<br>8:00, 8:20*, <u>8:40</u>',
    '<span class="big">7:00, 7:20*, <u>7:35</u><br>8:00, 8:20*, <u>8:40</u></span><br><br><u>ר"ח בה"ב ותעני"צ</u><br>6:40, 7:00*, <u>7:15,7:35</u>**<br>8:00, 8:20*, <u>8:40</u>',
]
LEGACY_WEEKDAY_FOOTER = [
    "All underlined מנינים will be בבית מדרש למטה\nבעזרת נשים*\nבאולם השמחות**",
    "All underlined מנינים will be בבית מדרש למטה\n*בעזרת נשים\n**באולם השמחות",
    "All underlined מנינים will be בבית מדרש למטה\n*בעזרת נשים **באולם השמחות",
]
LEGACY_ACCENT_COLORS = ["#54595f"]

# ט' באב used to be hardcoded into the sheet builders. It is an ordinary rule now, so it can
# be seen, edited, disabled or deleted like any other, and it matches on the Hebrew date,
# which recurs every year unlike a fixed Gregorian one.
#
# It fires on the two Shabbosim where the fast begins מוצאי שבת. Weeks are anchored on their
# Shabbos, so that is the Shabbos of 8 Av, the fast being the next day, and the Shabbos of
# 9 Av, where the fast is נדחה to Sunday.
TISHA_BAV_RULE = {
    "id": "rule-tisha-bav",
    "name": "ט באב: מוצאי שבת",
    "enabled": True,
    "condition": {"hebrewDate": ["5-8", "5-9"]},
    "columnKeys": ["kayitz:B", "kayitz:C", "choref:B", "choref:C"],
    "mode": "append",
    "value": "ט באב",
}

# The two דרשה rules, seeded for the same reason the Lakewood settings are built in: they
# are the shul's standing schedule rather than one person's preference.
DRASHA_RULES = [
    {"id": "rule-shabbos-hagadol", "name": "שבת הגדול: דרשה", "enabled": True,
     "condition": {"specialParsha": ["הגדול", "Hagadol"]},
     "columnKeys": ["kayitz:C", "choref:C"], "mode": "append", "value": "דרשה"},
    {"id": "rule-shabbos-shuva", "name": "שבת שובה: דרשה", "enabled": True,
     "condition": {"specialParsha": ["שובה", "Shuva"]},
     "columnKeys": ["kayitz:C", "choref:C"], "mode": "append", "value": "דרשה"},
]


def _already_covered(rules, rule) -> bool:
    """Whether some rule already covers the same special Shabbos.

    These two were made by hand before they were seeded, so on the install they were made
    in they exist under their own ids: seeding by id alone would sit a second דרשה on top of
    the first.
    """
    wanted = rule["condition"]["specialParsha"]
    return any(
        r.get("id") == rule["id"] or any(p in wanted for p in (r.get("condition") or {}).get("specialParsha", []))
        for r in rules
    )


def apply_seeds(state: dict) -> dict:
    """Installs the shipped rules once, recording that it happened, so deleting one sticks
    instead of having it come back on the next load."""
    seeded = state.setdefault("seeded", {})
    if not seeded.get("drashos"):
        for rule in DRASHA_RULES:
            if not _already_covered(state["rules"], rule):
                state["rules"].append(dict(rule))
        seeded["drashos"] = True
    if not seeded.get("tishaBav"):
        if not any(r.get("id") == TISHA_BAV_RULE["id"] for r in state["rules"]):
            state["rules"].append(dict(TISHA_BAV_RULE))
        seeded["tishaBav"] = True
    # The first version of this rule matched only 9 Av, missing the years where 9 Av falls on
    # a Sunday and the Shabbos before it is 8 Av. Widen a copy still carrying exactly the old
    # condition, which is an untouched seed, and leave a hand edited one alone.
    for rule in state["rules"]:
        if rule.get("id") == TISHA_BAV_RULE["id"] and rule.get("condition") == {"hebrewDate": ["5-9"]}:
            rule["condition"] = {"hebrewDate": ["5-8", "5-9"]}
    return state


def normalize_settings(raw: dict | None) -> dict:
    merged = {**DEFAULT_SETTINGS, **(raw or {})}
    merged["sheetStyle"] = {**DEFAULT_SETTINGS["sheetStyle"], **((raw or {}).get("sheetStyle") or {})}
    if merged.get("weekdayShacharis") in LEGACY_WEEKDAY_SHACHARIS:
        merged["weekdayShacharis"] = DEFAULT_WEEKDAY_SHACHARIS
    if merged.get("weekdayFooterNote") in LEGACY_WEEKDAY_FOOTER:
        merged["weekdayFooterNote"] = DEFAULT_SETTINGS["weekdayFooterNote"]
    if str(merged["sheetStyle"].get("accentColor", "")).lower() in LEGACY_ACCENT_COLORS:
        merged["sheetStyle"]["accentColor"] = DEFAULT_ACCENT_COLOR
    return merged


def normalize_sheets(sheets: list) -> list:
    """The same carry-forward for sheets already saved.

    A sheet keeps its own copy of the style, so changing the default alone would leave every
    existing chart on the old dark header while new ones came out light. Only the exact old
    default is moved; a colour picked by hand is left alone.
    """
    for sheet in sheets or []:
        style = sheet.get("style")
        if style and str(style.get("accentColor", "")).lower() in LEGACY_ACCENT_COLORS:
            style["accentColor"] = DEFAULT_ACCENT_COLOR
    return sheets or []


def default_state() -> dict:
    return apply_seeds({"settings": normalize_settings({}), "sheets": [], "rules": [], "seeded": {}})


def from_json(text: str) -> dict:
    """A state object out of a JSON document, whether written here or exported from the web
    version's Settings. The two are the same format on purpose."""
    parsed = json.loads(text)
    return apply_seeds({
        "settings": normalize_settings(parsed.get("settings")),
        "sheets": normalize_sheets(parsed.get("sheets") or []),
        "rules": parsed.get("rules") or [],
        # seeded comes across too: without it, restoring a backup made after deliberately
        # deleting a seeded rule would hand it straight back on the next load.
        "seeded": parsed.get("seeded") or {},
    })


def to_json(state: dict) -> str:
    return json.dumps(state, ensure_ascii=False, indent=2)


def load(path: Path) -> dict:
    try:
        return from_json(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default_state()
    except (json.JSONDecodeError, ValueError, KeyError, TypeError) as err:
        # Never lose the file over a parse error: it is the only copy of the user's work.
        broken = Path(path).with_suffix(".broken.json")
        Path(path).replace(broken)
        raise RuntimeError(f"The saved file could not be read ({err}). It has been kept as {broken.name}.")


def save(path: Path, state: dict) -> None:
    """Written to a neighbour and moved into place, so an interrupted write cannot leave a
    half saved file where the real one was."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(to_json(state), encoding="utf-8")
    temporary.replace(path)


# --- weeks at the edges -------------------------------------------------------------------
def week_records(weeks) -> list:
    """Engine weeks into the JSON shape, with the date written the way JSON.stringify writes
    a Date, so a file from here opens in the web version too."""
    return [
        {
            "serial": w.serial,
            "date": datetime(w.date.year, w.date.month, w.date.day).isoformat(timespec="milliseconds") + "Z",
            "parsha": w.parsha,
            "specialParsha": w.special_parsha,
        }
        for w in weeks
    ]


def week_objects(records) -> list:
    """And back again. The date is taken from the serial rather than parsed out of the
    string: the serial is what every formula is anchored on, and a file hand edited into a
    disagreement between the two should follow the serial."""
    return [
        Week(
            serial=int(r["serial"]),
            date=date_from_serial(int(r["serial"])),
            parsha=r.get("parsha") or "",
            special_parsha=r.get("specialParsha") or "",
        )
        for r in records
    ]


def resolved_settings(state: dict):
    return resolve(state["settings"])


@dataclass(frozen=True)
class Paths:
    """Where the program keeps things. Kept in one place so a portable build can move it."""
    state: Path

    @staticmethod
    def under(folder: Path) -> "Paths":
        return Paths(state=Path(folder) / STATE_FILE)
