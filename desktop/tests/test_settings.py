"""Settings and Rules, driven the way a person drives them.

    python3 desktop/tests/test_settings.py
"""
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "desktop"))

# A Windows console writes cp1252, and every test name here is in Hebrew. Without this, a run
# where every single check passed still ends non-zero, on the print at the end rather than on
# anything it measured. errors="replace" is for the underline sentinels, U+E000 and U+E001,
# which are private use characters with no glyph in any font.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from PySide6.QtWidgets import QApplication, QLineEdit  # noqa: E402

_app = QApplication.instance() or QApplication([])

from zmanimboard import sheets as sheetlib, state as statelib  # noqa: E402
from zmanimboard.app import Window  # noqa: E402
from zmanimboard.engine import pagination as pag, tables as tables_mod  # noqa: E402
from zmanimboard.engine.settings import DEFAULT_SETTINGS  # noqa: E402
from zmanimboard.engine.sheets import weeks as weeks_mod  # noqa: E402
from zmanimboard.htmlfield import HtmlField  # noqa: E402
from zmanimboard.rulesui import RuleDialog, describe, describe_target  # noqa: E402

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

# --- the rich text boxes ------------------------------------------------------------------
# What goes in has to come out. These fields hold the שחרית schedules and the footer notes,
# and they travel to the printed board and into a backup, so anything the box adds of its own
# ends up on paper. QTextEdit's own toHtml() is a whole styled document; this is the subset.
for key in ("weekdayShacharis", "weekdayShacharisSpecial", "weekdayFooterNote", "footerNote", "headerRabbiLine"):
    field = HtmlField(DEFAULT_SETTINGS[key])
    # The stored form for a newline is <br>; the shipped defaults use a bare newline, which
    # every renderer already treats the same way.
    R.equal(f"{key} survives the editor", DEFAULT_SETTINGS[key].replace("\n", "<br>"), field.value())

R.equal("the .big wrapper is kept but not edited", True, HtmlField(DEFAULT_SETTINGS["weekdayShacharis"]).was_big)
R.equal("and a plain field has none", False, HtmlField(DEFAULT_SETTINGS["footerNote"]).was_big)

# --- describing a rule ---------------------------------------------------------------------
seeded = statelib.default_state()["rules"]
hagadol = next(r for r in seeded if r["id"] == "rule-shabbos-hagadol")
R.equal("a rule says when it fires", "On a special Shabbos: הגדול, Hagadol", describe(hagadol))
R.equal("and what it does", "Adds kayitz:C, choref:C", describe_target(hagadol))
R.equal("an always rule reads plainly", "Every week", describe({"condition": {"always": True}}))

with tempfile.TemporaryDirectory() as tmp:
    folder = Path(tmp)
    window = Window(folder)

    settings_screen = window.screens["settings"]
    settings_screen.refresh()
    R.equal("the seeded rules are listed", 3, settings_screen.rules_table.rowCount())

    # --- editing a setting ------------------------------------------------------------------
    settings_screen.fields["footerAddress"].setText("Somewhere Else 1 High Street")
    settings_screen.fields["candleLightingMinutes"].setValue(20)
    settings_screen.fields["weekdayShacharisSpecial"].set_value("6:45, <u>7:10</u>")
    settings_screen.save()

    saved = statelib.load(folder / "zmanim-state.json")
    R.equal("a typed setting is saved", "Somewhere Else 1 High Street", saved["settings"]["footerAddress"])
    R.equal("a number is saved", 20, saved["settings"]["candleLightingMinutes"])
    R.equal("and a rich text field is saved as its subset", "6:45, <u>7:10</u>", saved["settings"]["weekdayShacharisSpecial"])

    # Candle lighting really reaches the page: it is a formula input, not a label.
    resolved = statelib.resolved_settings(saved)
    R.equal("and candle lighting reaches the formula", 20, resolved.candle_lighting_minutes)

    # --- a rule made here fires -------------------------------------------------------------
    dialog = RuleDialog(settings_screen)
    dialog.name.setText("שבת שירה: מוקדם")
    dialog.condition.setCurrentIndex([c[0] for c in __import__("zmanimboard.rulesui", fromlist=["CONDITIONS"]).CONDITIONS].index("specialParsha"))
    dialog.values.setText("שירה")
    dialog.boxes["choref:C"].setChecked(True)
    dialog.mode.setCurrentIndex(0)  # add a line
    dialog.value.set_value("מוקדם")
    made = dialog.rule()
    R.equal("the dialog builds the condition", {"specialParsha": ["שירה"]}, made["condition"])
    R.equal("and the target column", ["choref:C"], made["columnKeys"])

    window.state["rules"].append(made)
    window.persist()

    engine_settings = statelib.resolved_settings(window.state)
    built = weeks_mod.compute_season_weeks("choref", 5787, engine_settings, TABLES)
    window.state["sheets"] = sheetlib.generate("choref", 5787, pag.default_page_sizes(len(built.weeks), 3),
                                               engine_settings, TABLES, window.state["settings"])
    sheet = window.state["sheets"][0]
    pages = sheetlib.chart_pages(sheet, window.state, engine_settings)
    shira = [(w.serial, p) for p in pages for w in p.weeks if w.special_parsha == "שירה"]
    R.expect("the season has a שבת שירה", bool(shira), f"{len(shira)} weeks")
    if shira:
        serial, page = shira[0]
        R.expect("and the new rule is on it", page.rows[serial]["C"].endswith("מוקדם"), repr(page.rows[serial]["C"])[-22:])

    # --- deleting sticks ---------------------------------------------------------------------
    window.state["rules"] = [r for r in window.state["rules"] if r["id"] != "rule-shabbos-shuva"]
    window.persist()
    reloaded = statelib.load(folder / "zmanim-state.json")
    R.expect("a deleted rule stays deleted after a reload",
             not any(r["id"] == "rule-shabbos-shuva" for r in reloaded["rules"]),
             f'{len(reloaded["rules"])} rules')

    # --- import replaces everything -----------------------------------------------------------
    backup = folder / "backup.json"
    backup.write_text((ROOT / "data" / "published.json").read_text(encoding="utf-8"), encoding="utf-8")
    window.state = statelib.from_json(backup.read_text(encoding="utf-8"))
    window.persist()
    window.rebuild()
    published = json.loads(backup.read_text(encoding="utf-8"))
    R.equal("an imported backup brings its sheets", len(published["sheets"]), len(window.state["sheets"]))
    R.equal("and its settings", published["settings"]["footerAddress"], window.state["settings"]["footerAddress"])

    # rebuild has to make the screens afresh: they were holding the settings just replaced.
    R.equal("the screens are rebuilt against the new state",
            published["settings"]["footerAddress"],
            window.screens["settings"].fields["footerAddress"].text())
    # A screen loads its contents when it is shown, so this is the click a person makes.
    window.show_screen("saved")
    R.expect("and the sheets show up on Saved sheets", window.screens["saved"].table.rowCount() > 0,
             f'{window.screens["saved"].table.rowCount()} rows')
    R.expect("and the visible screen really is that one", window.stack.currentWidget() is window.screens["saved"], "")

    # The imported sheets still print, hand typed cells and all.
    with_override = next(s for s in window.state["sheets"] if s.get("overrides"))
    pages = sheetlib.chart_pages(with_override, window.state, statelib.resolved_settings(window.state))
    typed = [(serial, cells) for serial, cells in with_override["overrides"].items()]
    serial, cells = typed[0]
    page = next(p for p in pages if int(serial) in p.rows)
    R.equal("a hand typed cell from the backup reaches the page",
            cells[next(iter(cells))], page.rows[int(serial)][next(iter(cells))])

sys.exit(0 if R.summary() else 1)
