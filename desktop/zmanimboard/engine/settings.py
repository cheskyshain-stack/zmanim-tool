"""The settings model, mirroring the workbook's SETTINGS sheet (js/settings.js).

Stored settings are a plain dict, which is what goes in and out of the save file and what
a backup exported from the web version already contains. resolve() turns one into the
Settings object the engine expects, with the timezone looked up and the language flag
worked out.
"""
from dataclasses import dataclass

from .solar import Timezone

# A small curated set, not the operating system's timezone database: the workbook models
# only two DST rules, the US one and none at all, and the labels say so where a zone's
# real rule is not modelled.
TIMEZONES = [
    Timezone("America/New_York", "America/New_York (Eastern)", -5, 1, "us"),
    Timezone("America/Chicago", "America/Chicago (Central)", -6, 1, "us"),
    Timezone("America/Denver", "America/Denver (Mountain)", -7, 1, "us"),
    Timezone("America/Los_Angeles", "America/Los_Angeles (Pacific)", -8, 1, "us"),
    Timezone("America/Anchorage", "America/Anchorage", -9, 1, "us"),
    Timezone("Pacific/Honolulu", "Pacific/Honolulu (no DST)", -10, 0, "none"),
    Timezone("Asia/Jerusalem", "Asia/Jerusalem (DST not modeled, matches source workbook)", 2, 0, "none"),
    Timezone("Europe/London", "Europe/London (DST not modeled, matches source workbook)", 0, 0, "none"),
    Timezone("UTC", "UTC", 0, 0, "none"),
]

# The everyday שחרית schedule as it appears on the shul's printed board, with the
# alternate times underlined. Rich text, because that is how it is edited and printed.
DEFAULT_WEEKDAY_SHACHARIS = '<span class="big">7:00, 7:20*, <u>7:35</u>\n8:00, 8:20*, <u>8:40</u></span>'
# The second schedule, for ר"ח / בה"ב / תענית. Kept apart from the everyday one so a week
# card can show it only on weeks that have one of those days and name which it is. The
# printed chart still shows both, covering a whole season at once.
DEFAULT_WEEKDAY_SHACHARIS_SPECIAL = '6:40, 7:00*, <u>7:15</u>, 7:35**\n8:00, 8:20*, <u>8:40</u>'
SPECIAL_SHACHARIS_HEADING = 'ר"ח בה"ב ותענ"צ'

# The chart's header colour, which the parsha column used to be painted in too. Light
# gray with dark ink rather than the dark gray it shipped with: a full column of solid
# dark on every page is a lot of toner.
DEFAULT_ACCENT_COLOR = "#c9ced5"

SEASON_LABELS = {"kayitz": "שבת קיץ", "choref": "שבת חורף", "weekday": "Weekday"}

DEFAULT_SETTINGS = {
    "shulName": "קהל לב מנחם",
    "headerSubtitle": "ליקוואוד קאמענס",
    "headerRabbiLine": 'הרב אריה שרבינטר שליט"א\nמרא דאתרא',
    "headerIconImage": None,
    "footerNote": "All underlined מנינים will be בבית מדרש למטה\nAll zmanim are rounded off. Please be מחמיר two minutes.",
    "footerAddress": "Bais Medrash Lakewood Commons 44 Coles Way Lakewood, NJ 08701",
    # מנחה and מעריב are intentionally blank and have no settings field: those differ every
    # week. The keys stay so older saved backups still load cleanly.
    "weekdayDefaultMincha": "",
    "weekdayDefaultMaariv": "",
    "weekdayShacharis": DEFAULT_WEEKDAY_SHACHARIS,
    "weekdayShacharisSpecial": DEFAULT_WEEKDAY_SHACHARIS_SPECIAL,
    "weekdayFooterNote": "All underlined מנינים will be בבית מדרש למטה\nבעזרת נשים **באולם השמחות*",
    "locationName": "Lakewood",
    "latitude": 40.068,
    "longitude": -74.205,
    "elevation": 0,
    "timezoneId": "America/New_York",
    "language": "he",
    "horizon": 5 / 6,
    "candleLightingMinutes": 18,
    "ateretTorahTzaisOffset": 40,
    "useAstronomicalChatzos": True,
    "useElevation": False,
    "inIsrael": False,
    "useGregorianBefore1582": False,
    "sheetStyle": {"fontFamily": "Times New Roman", "fontSizePt": 10, "headerScale": 1, "accentColor": DEFAULT_ACCENT_COLOR},
}


@dataclass(frozen=True)
class Settings:
    """What the calculation engine reads. Everything else about a shul's setup lives in
    the raw dict and never reaches a formula."""
    latitude: float
    longitude: float
    elevation: float
    timezone: Timezone
    horizon: float
    candle_lighting_minutes: float
    use_astronomical_chatzos: bool
    use_elevation: bool
    in_israel: bool
    use_gregorian_before_1582: bool
    english: bool


def resolve(raw: dict) -> Settings:
    merged = {**DEFAULT_SETTINGS, **(raw or {})}
    tz = next((z for z in TIMEZONES if z.id == merged["timezoneId"]), TIMEZONES[0])
    return Settings(
        latitude=merged["latitude"],
        longitude=merged["longitude"],
        elevation=merged["elevation"],
        timezone=tz,
        horizon=merged["horizon"],
        candle_lighting_minutes=merged["candleLightingMinutes"],
        use_astronomical_chatzos=bool(merged["useAstronomicalChatzos"]),
        use_elevation=bool(merged["useElevation"]),
        in_israel=bool(merged["inIsrael"]),
        use_gregorian_before_1582=bool(merged["useGregorianBefore1582"]),
        english=merged["language"] == "en",
    )
