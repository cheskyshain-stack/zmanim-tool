"""What the program remembers, and what it makes.

The important one is the round trip. The user has real data in the web version, and this
program has to open a backup exported from it and give back the same sheets, the same hand
typed cell overrides and the same rules. data/published.json is used as the sample: it is
the same format, written by the same code, and it carries a real hand typed override.

    python3 desktop/tests/test_state.py
"""
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "desktop"))

# A Windows console writes cp1252, and every test name here is in Hebrew. Without this, a run
# where every single check passed still ends non-zero, on the print at the end rather than on
# anything it measured. errors="replace" is for the underline sentinels, U+E000 and U+E001,
# which are private use characters with no glyph in any font.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from zmanimboard import sheets as sheetlib  # noqa: E402
from zmanimboard import state as statelib  # noqa: E402
from zmanimboard.engine import pagination as pag, tables as tables_mod  # noqa: E402
from zmanimboard.engine.sheets import weeks as weeks_mod  # noqa: E402

TABLES = tables_mod.load()


class Report:
    def __init__(self):
        self.rows = []
        self.failed = False

    def expect(self, name, ok, detail=""):
        self.rows.append((name, bool(ok), detail))
        if not ok:
            self.failed = True

    def equal(self, name, want, got):
        self.expect(name, want == got, "" if want == got else f"\n      want {want!r}\n      got  {got!r}")

    def summary(self):
        width = max(len(n) for n, _, _ in self.rows)
        for name, ok, detail in self.rows:
            print(f"  {'ok  ' if ok else 'FAIL'} {name.ljust(width)}  {detail}")
        print(f"\n  {sum(1 for _, ok, _ in self.rows if ok)} of {len(self.rows)} checks passed.")
        return not self.failed


R = Report()

# --- a fresh install ------------------------------------------------------------------
fresh = statelib.default_state()
R.equal("a fresh install seeds three rules",
        ["rule-shabbos-hagadol", "rule-shabbos-shuva", "rule-tisha-bav"],
        [r["id"] for r in fresh["rules"]])
R.equal("ט באב matches both Shabbosim", {"hebrewDate": ["5-8", "5-9"]},
        next(r["condition"] for r in fresh["rules"] if r["id"] == "rule-tisha-bav"))

# Deleting a seeded rule sticks: that is what the seeded flags are for.
after_delete = dict(fresh, rules=[r for r in fresh["rules"] if r["id"] != "rule-shabbos-shuva"])
reloaded = statelib.from_json(statelib.to_json(after_delete))
R.expect("deleting a seeded rule sticks",
         not any(r["id"] == "rule-shabbos-shuva" for r in reloaded["rules"]),
         f'{len(reloaded["rules"])} rules')

# A rule made by hand covering the same special Shabbos is not doubled up by seeding.
handmade = {"id": "mine", "name": "my דרשה", "enabled": True,
            "condition": {"specialParsha": ["הגדול"]}, "columnKeys": ["choref:C"], "mode": "append", "value": "דרשה"}
seeded_over = statelib.apply_seeds({"settings": {}, "sheets": [], "rules": [handmade], "seeded": {}})
R.equal("seeding does not double a hand made rule", 1,
        len([r for r in seeded_over["rules"] if "הגדול" in (r["condition"].get("specialParsha") or [])]))

# --- the round trip -------------------------------------------------------------------
published = json.loads((ROOT / "data" / "published.json").read_text(encoding="utf-8"))
imported = statelib.from_json(json.dumps(published))
R.equal("every published sheet arrives", len(published["sheets"]), len(imported["sheets"]))
R.equal("settings arrive", published["settings"]["footerAddress"], imported["settings"]["footerAddress"])

with_override = next(s for s in imported["sheets"] if s.get("overrides"))
serial, cells = next(iter(with_override["overrides"].items()))
R.expect("a hand typed cell survives the import", "<u>" in next(iter(cells.values())),
         f'sheet {with_override["season"]} {with_override["hebrewYear"]}, week {serial}, column {next(iter(cells))}')

with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / "state.json"
    statelib.save(path, imported)
    again = statelib.load(path)
    R.equal("saved and loaded is the same thing", statelib.to_json(imported), statelib.to_json(again))
    R.expect("nothing is left behind by the write", not list(Path(tmp).glob("*.tmp")), "")

# --- generating -----------------------------------------------------------------------
settings = statelib.resolved_settings(fresh)
# The page splits are read out of the golden fixture rather than written here. Written by
# hand the weekday split for קיץ 5786 was guessed as [9, 8, 8] and the real answer is
# [9, 7, 9]: the fixture is the authority on every number in this program, and a test that
# repeats one from memory is just a second place for it to be wrong.
GOLDEN = json.loads((ROOT / "fixtures" / "golden.json").read_text(encoding="utf-8"))


def golden_season(season, year):
    return next(s for s in GOLDEN["seasons"] if s["season"] == season and s["hebrewYear"] == year)


for season, year in (("choref", 5787), ("kayitz", 5786)):
    reference = golden_season(season, year)
    want_pages, want_weekday = reference["pageSizes"], reference["weekdayPageSizes"]
    built = weeks_mod.compute_season_weeks(season, year, settings, TABLES)
    made = sheetlib.generate(season, year, pag.default_page_sizes(len(built.weeks), 3),
                             settings, TABLES, fresh["settings"])
    tag = f"{season} {year}"
    R.equal(f"{tag}: a sheet and its weekday chart", ["choref" if season == "choref" else "kayitz", "weekday"],
            [s["season"] for s in made])
    R.equal(f"{tag}: page sizes", want_pages, made[0]["pageSizes"])
    R.equal(f"{tag}: the weekday chart breaks on the same dates", want_weekday, made[1]["pageSizes"])
    R.equal(f"{tag}: the pair is linked", made[0]["id"], made[1]["linkedSheetId"])
    R.equal(f"{tag}: the companion is found both ways",
            (made[1]["id"], made[0]["id"]),
            (sheetlib.companion_of(made[0], made)["id"], sheetlib.companion_of(made[1], made)["id"]))

    # The weeks written into the sheet come back as the same weeks.
    R.equal(f"{tag}: weeks round trip", [w.serial for w in built.weeks],
            [w.serial for w in statelib.week_objects(made[0]["weeks"])])

# --- rules and overrides reach the page -------------------------------------------------
state = dict(fresh, sheets=[])
made = sheetlib.generate("choref", 5787, [10, 9, 9], settings, TABLES, fresh["settings"])
state["sheets"] = made
pages = sheetlib.chart_pages(made[0], state, settings)
R.equal("a חורף season prints its last page as a קיץ chart", ["choref", "choref", "kayitz"],
        [p.effective_season for p in pages])
R.equal("the קיץ page carries קיץ's twelve columns", 11, len(pages[-1].columns))

drasha = [(w.serial, p) for p in pages for w in p.weeks if w.special_parsha == "הגדול"]
R.expect("the שבת הגדול rule fires", bool(drasha), f"{len(drasha)} weeks")
if drasha:
    serial, page = drasha[0]
    R.expect("and puts דרשה in the מנחה cell", "דרשה" in page.rows[serial]["C"], repr(page.rows[serial]["C"])[-30:])
    R.expect("and the cell is flagged as rule touched", "C" in page.ruled.get(serial, set()), "")

# A hand typed cell wins over both. Stored under the week's serial as a string key, which is
# what JSON does to a number, so both forms have to be read.
target = made[0]["weeks"][0]["serial"]
made[0]["overrides"] = {str(target): {"C": "<u>1:40</u><br>נסיון"}}
pages = sheetlib.chart_pages(made[0], state, settings)
first = pages[0]
R.equal("a hand typed cell wins", "<u>1:40</u><br>נסיון", first.rows[target]["C"])
R.expect("and is flagged as typed", "C" in first.authored.get(target, set()), "")

# --- where a built program keeps the save file ------------------------------------------------
# Beside the program, which is what lets a copy on a USB stick carry its own boards. A Mac
# program is not one file but a folder, and the thing that runs is buried three levels down
# inside it, so the naive answer would hide someone's boards inside the application and lose
# them the day it is replaced with a newer copy.
from zmanimboard.app import beside_the_program  # noqa: E402

for name, executable, want in (
    ("a Windows program keeps it in its own folder", "E:/sticks/Zmanim.exe", "E:/sticks"),
    ("a Mac app keeps it beside the app, not inside it",
     "/Volumes/USB/Zmanim.app/Contents/MacOS/Zmanim", "/Volumes/USB"),
    ("and the same in Applications", "/Applications/Zmanim.app/Contents/MacOS/Zmanim", "/Applications"),
    ("a plain binary keeps it in its own folder", "/Volumes/USB/Zmanim", "/Volumes/USB"),
    # Contents/MacOS with no .app above it is not a bundle, so it is left where it is rather
    # than having three folders climbed off it.
    ("and a folder merely named like one is not treated as one",
     "/home/x/Contents/MacOS/Zmanim", "/home/x/Contents/MacOS"),
):
    R.equal(name, want, str(beside_the_program(Path(executable))))

sys.exit(0 if R.summary() else 1)
