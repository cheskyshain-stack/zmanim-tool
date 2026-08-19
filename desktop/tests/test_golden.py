"""The port is correct exactly to the extent this passes.

Every assertion here is against fixtures/golden.json, the reference output of the web
version's own engine. See fixtures/README.md. Run it with:

    python3 desktop/tests/test_golden.py

It prints a section by section tally and exits non-zero on the first section that fails,
after showing the first few differences in it.
"""
import json
import math
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "desktop"))

# A Windows console writes cp1252, and every test name here is in Hebrew. Without this, a run
# where every single check passed still ends non-zero, on the print at the end rather than on
# anything it measured. errors="replace" is for the underline sentinels, U+E000 and U+E001,
# which are private use characters with no glyph in any font.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from zmanimboard.engine import fmt, pagination as pag, rules as rules_mod, settings as settings_mod, solar, tables as tables_mod, util  # noqa: E402
from zmanimboard.engine import hebrew_calendar as cal  # noqa: E402
from zmanimboard.engine import zmanim as Z  # noqa: E402
from zmanimboard.engine.sheets import choref, common, kayitz, weekday, weeks as weeks_mod  # noqa: E402

GOLDEN = json.loads((ROOT / "fixtures" / "golden.json").read_text(encoding="utf-8"))
S = settings_mod.resolve(settings_mod.DEFAULT_SETTINGS)
TABLES = tables_mod.load()

# The fixture writes the invisible characters out so the file stays readable; this puts
# them back. See fixtures/README.md.
def unesc(s: str) -> str:
    return (s.replace("{U}", fmt.UL_START).replace("{/U}", fmt.UL_END)
             .replace("{NB}", util.NBSP).replace("{LF}", "\n"))


def iso(serial) -> str:
    return solar.date_from_serial(serial).isoformat()


class Report:
    def __init__(self):
        self.sections = []
        self.failed = False

    def check(self, name, cases):
        """cases yields (label, expected, actual) triples."""
        bad, n = [], 0
        for label, want, got in cases:
            n += 1
            if want != got:
                bad.append((label, want, got))
        self.sections.append((name, n, len(bad)))
        if bad:
            self.failed = True
            print(f"\nFAIL {name}: {len(bad)} of {n}")
            for label, want, got in bad[:8]:
                print(f"  {label}\n    want {want!r}\n    got  {got!r}")
            if len(bad) > 8:
                print(f"  ... and {len(bad) - 8} more")

    def summary(self):
        print()
        width = max(len(name) for name, _, _ in self.sections)
        for name, n, bad in self.sections:
            mark = "ok  " if not bad else "FAIL"
            print(f"  {mark} {name.ljust(width)}  {n - bad}/{n}")
        total = sum(n for _, n, _ in self.sections)
        total_bad = sum(bad for _, _, bad in self.sections)
        print(f"\n  {total - total_bad} of {total} checks passed.")
        return not self.failed


R = Report()

# --- formatting -----------------------------------------------------------------------
f = GOLDEN["formatting"]
R.check("format_time", ((f"{c['day']}", c["out"], fmt.format_time(c["day"])) for c in f["formatTime"]))
R.check("minute rounding", (
    (f"{c['day']} {op}", c[op], func(c["day"]))
    for c in f["rounding"]
    for op, func in (("ceil", fmt.ceil_to_minute), ("floor", fmt.floor_to_minute), ("round", fmt.round_to_minute))
))
R.check("underline_time", ((f"{c['in']}", unesc(c["out"]), fmt.underline_time(c["in"])) for c in f["underlineTime"]))
R.check("normalize_time_list", ((c["in"], c["out"], fmt.normalize_time_list(c["in"])) for c in f["normalizeTimeList"]))
R.check("split_lines_in_half", (
    (f"n={c['n']}", unesc(c["out"]), util.split_lines_in_half([f"{i + 1}:00" for i in range(c["n"])]))
    for c in f["splitLinesInHalf"]
))

# --- the calendar core ------------------------------------------------------------------
def year_cases():
    for y in GOLDEN["years"]:
        rh = cal.rosh_hashana(y["year"] - 3761)
        j = cal.hebrew_date_extended(rh)
        got = {
            "roshHashanaSerial": rh, "roshHashanaDate": iso(rh), "roshHashanaWeekday": cal.excel_weekday(rh),
            "yearLength": cal.rosh_hashana(y["year"] - 3760) - rh, "yearType": j.year_type, "leap": j.leap,
        }
        for key, want in got.items():
            yield f"AM {y['year']} {key}", y[key], want


R.check("rosh hashana and year type, 5700 to 5900", year_cases())

R.check("date_from_hebrew round trip", (
    (f"{c['in']}", (c["serial"], c["date"], c["out"]),
     (cal.date_from_hebrew(*c["in"]), iso(cal.date_from_hebrew(*c["in"])),
      [cal.hebrew_date_extended(cal.date_from_hebrew(*c["in"])).day_of_month,
       cal.hebrew_date_extended(cal.date_from_hebrew(*c["in"])).month,
       cal.hebrew_date_extended(cal.date_from_hebrew(*c["in"])).year]))
    for c in GOLDEN["hebrewRoundTrip"]
))


def calendar_cases():
    for c in GOLDEN["calendar"]:
        s_ = c["serial"]
        j = cal.hebrew_date_extended(s_, S.use_gregorian_before_1582)
        got = {
            "weekday": cal.excel_weekday(s_),
            "h": [j.day_of_month, j.month, j.year],
            "dayOfYear": j.day_of_year,
            "yearType": j.year_type,
            "leap": j.leap,
            "he": cal.jewish_date_string(s_, False),
            "en": cal.jewish_date_string(s_, True),
            "parsha": cal.has_parsha(s_, S, TABLES),
            "specialParsha": cal.has_special_parsha(s_, S),
            "yomTov": cal.has_yom_tov(s_, S, TABLES.special_days),
            "roshChodesh": cal.has_rosh_chodesh(s_, S),
            "behab": cal.has_behab(s_, S),
            "taanis": cal.has_taanis(s_, S),
        }
        for key, value in got.items():
            # The fixture leaves an empty string out entirely, to keep a quiet day short.
            yield f"{c['date']} {key}", c.get(key, "" if isinstance(value, str) else value), value
        yield f"{c['date']} assurMelacha", c.get("assurMelacha", False), cal.is_assur_melacha(s_, S)


R.check("the calendar, day by day", calendar_cases())

# --- zmanim ------------------------------------------------------------------------------
# The strings must match exactly. The raw values are doubles that went through sin, cos and
# asin in two different runtimes, so they are held to 1e-9 of a day: under a tenth of a
# millisecond, and thousands of times tighter than the epsilon the minute rounding uses.
TOLERANCE = 1e-9
ZMANIM = [
    ("sunrise", Z.sunrise), ("sunset", Z.sunset), ("sunriseElev", Z.sunrise_elev), ("sunsetElev", Z.sunset_elev),
    ("solarNoon", Z.solar_noon), ("alos16_1", Z.alos_16_1), ("misheyakir10_2", Z.misheyakir_10_2),
    ("tzais50", Z.tzais_50), ("tzais60", Z.tzais_60), ("tzais72", Z.tzais_72), ("tzaisGeonim8_5", Z.tzais_geonim_8_5),
    ("alos72", Z.alos_72), ("minchaGedola", Z.mincha_gedola),
    ("minchaGedola30MinAfterChatzos", Z.mincha_gedola_30_min_after_chatzos),
    ("minchaGedolaLechumra", Z.mincha_gedola_lechumra), ("minchaKetana", Z.mincha_ketana),
    ("samuchLeminchaKetana", Z.samuch_lemincha_ketana), ("plagHamincha", Z.plag_hamincha),
    ("sofZmanShmaGRA", Z.sof_zman_shma_gra), ("sofZmanShmaMGA72", Z.sof_zman_shma_mga_72),
    ("sofZmanTfilaGRA", Z.sof_zman_tfila_gra),
]


def zmanim_cases():
    worst = 0.0
    for c in GOLDEN["zmanim"]:
        d = solar.date_from_serial(c["serial"])
        yield f"{c['date']} dst", c["dst"], Z.dst_local(d, S)
        for name, func in ZMANIM:
            value = func(d, S)
            yield f"{c['date']} {name} time", c[name]["time"], fmt.format_time(value)
            delta = abs(value - c[name]["day"])
            worst = max(worst, delta)
            yield f"{c['date']} {name} value", True, delta <= TOLERANCE
    print(f"  (worst raw zman difference against the fixture: {worst:.3e} of a day)")


R.check("all 21 zmanim, every day of 2026", zmanim_cases())

# --- built rows ---------------------------------------------------------------------------
BUILDERS = {"kayitz": (kayitz.build_kayitz_row, kayitz.KAYITZ_COLUMNS), "choref": (choref.build_choref_row, choref.CHOREF_COLUMNS)}
SEEDED = [
    {"id": "rule-shabbos-hagadol", "enabled": True, "condition": {"specialParsha": ["הגדול", "Hagadol"]},
     "columnKeys": ["kayitz:C", "choref:C"], "mode": "append", "value": "דרשה"},
    {"id": "rule-shabbos-shuva", "enabled": True, "condition": {"specialParsha": ["שובה", "Shuva"]},
     "columnKeys": ["kayitz:C", "choref:C"], "mode": "append", "value": "דרשה"},
    {"id": "rule-tisha-bav", "enabled": True, "condition": {"hebrewDate": ["5-8", "5-9"]},
     "columnKeys": ["kayitz:B", "kayitz:C", "choref:B", "choref:C"], "mode": "append", "value": "ט באב"},
]


def season_cases():
    firings = []
    for want in GOLDEN["seasons"]:
        season, year = want["season"], want["hebrewYear"]
        tag = f"{season} {year}"
        built = weeks_mod.compute_season_weeks(season, year, S, TABLES)
        wd = weeks_mod.compute_weekday_weeks(season, year, S, TABLES)

        yield f"{tag} range", (want["range"]["start"], want["range"]["end"]), (iso(built.start_serial), iso(built.end_serial))
        yield f"{tag} week count", want["weekCount"], len(built.weeks)
        yield f"{tag} weekday week count", want["weekdayWeekCount"], len(wd.weeks)

        page_sizes = pag.default_page_sizes(len(built.weeks), 3)
        yield f"{tag} pageSizes", want["pageSizes"], page_sizes
        yield f"{tag} weekdayPageSizes", want["weekdayPageSizes"], pag.align_page_sizes_to(built.weeks, page_sizes, wd.weeks)

        split = pag.split_weeks_into_pages(built.weeks, page_sizes)
        effective = [
            season if season != "choref" else ("kayitz" if any(common.in_spring_dst_window(w.date, S) for w in pw) else "choref")
            for pw in split
        ]
        yield f"{tag} pages", want["pages"], [
            {"weeks": len(pw), "from": iso(pw[0].serial) if pw else None,
             "to": iso(pw[-1].serial) if pw else None, "effectiveSeason": effective[i]}
            for i, pw in enumerate(split)
        ]

        want_rows = {r["date"]: r for r in want["rows"]}
        for page_index, page_weeks in enumerate(split):
            eff = effective[page_index]
            build_row, columns = BUILDERS[eff]
            for w in page_weeks:
                want_row = want_rows[iso(w.serial)]
                computed = build_row(w, S)
                yield f"{tag} {iso(w.serial)} builtAs", want_row["builtAs"], eff
                yield f"{tag} {iso(w.serial)} page", want_row["page"], page_index
                yield f"{tag} {iso(w.serial)} parsha", want_row["parsha"], w.parsha
                yield f"{tag} {iso(w.serial)} specialParsha", want_row.get("specialParsha", ""), w.special_parsha
                for key, _header in columns:
                    yield f"{tag} {iso(w.serial)} col {key}", unesc(want_row[key]), computed[key]

                applied = set()
                hebrew = cal.hebrew_date_extended(w.serial, S.use_gregorian_before_1582)
                ruled = rules_mod.apply_rules(computed, w, SEEDED, eff, hebrew, applied)
                if applied:
                    firings.append({
                        "season": season, "year": year, "date": iso(w.serial), "builtAs": eff,
                        "parsha": w.parsha, "specialParsha": w.special_parsha,
                        "columns": sorted(applied), "after": {k: ruled[k] for k in sorted(applied)},
                    })

        want_wd = {r["date"]: r for r in want["weekdayRows"]}
        for w in wd.weeks:
            want_row = want_wd[iso(w.serial)]
            computed = weekday.build_weekday_row(w, S)
            yield f"{tag} weekday {iso(w.serial)} label", want_row["label"], w.parsha
            for key in ("B", "C"):
                yield f"{tag} weekday {iso(w.serial)} col {key}", unesc(want_row[key]), computed[key]

    # The seeded rules, compared as one list so an extra or missing firing shows up too.
    want_firings = [
        {**fire, "after": {k: unesc(v) for k, v in fire["after"].items()}}
        for fire in GOLDEN["seededFirings"]
    ]
    yield "seeded rule firings", want_firings, firings


R.check("season week lists, page splits and every built cell", season_cases())

# --- the named edge cases ------------------------------------------------------------------
def edge_cases():
    e = GOLDEN["edgeCases"]
    for c in e["dstCutovers"]:
        d = date.fromisoformat(c["date"])
        yield f"dst {c['date']}", (c["dst"], c["springWindow"], c["sunset"]), (Z.dst_local(d, S), common.in_spring_dst_window(d, S), fmt.format_time(Z.sunset(d, S)))
    for c in e["springWindowIsSpringOnly"]:
        d = date.fromisoformat(c["date"])
        yield f"spring window {c['date']}", c["springWindow"], common.in_spring_dst_window(d, S)
    for c in e["tishaBav"]:
        serial = cal.date_from_hebrew(9, 5, c["hebrewYear"])
        yield f"9 Av {c['hebrewYear']}", (c["date"], c["weekday"], c["taanis"], c["deferred"]), (iso(serial), cal.excel_weekday(serial), cal.has_taanis(serial, S), cal.excel_weekday(serial) == 7)
    for c in e["yomTovShabbosos"]:
        serial = solar.excel_serial(date.fromisoformat(c["date"]))
        name = cal.has_yom_tov(serial, S, TABLES.special_days)
        yield f"yom tov shabbos {c['date']}", (c["yomTov"], c["isYomTovLabel"], c["printedAs"]), (name, cal.is_yom_tov_week_label(name), cal.week_of_label(name, False))


R.check("the named edge cases", edge_cases())

sys.exit(0 if R.summary() else 1)
