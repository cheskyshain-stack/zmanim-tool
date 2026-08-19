"""This week: which week the screen opens on, and what goes on the two cards.

    python3 desktop/tests/test_week.py
"""
import os
import sys
import tempfile
from datetime import date
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "desktop"))

# A Windows console writes cp1252, and every test name here is in Hebrew. Without this, a run
# where every single check passed still ends non-zero, on the print at the end rather than on
# anything it measured. errors="replace" is for the underline sentinels, U+E000 and U+E001,
# which are private use characters with no glyph in any font.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import fitz  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

_app = QApplication.instance() or QApplication([])

from zmanimboard import sheets as sheetlib, state as statelib, weeks as weeklib  # noqa: E402
from zmanimboard.engine import pagination as pag, tables as tables_mod  # noqa: E402
from zmanimboard.engine.sheets import weeks as weeks_mod  # noqa: E402
from zmanimboard.engine.solar import date_from_serial, excel_serial  # noqa: E402
from zmanimboard.render.output import write_card_pair_pdf, write_card_pdf  # noqa: E402

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

state = statelib.default_state()
settings = statelib.resolved_settings(state)
raw = state["settings"]
built = weeks_mod.compute_season_weeks("choref", 5787, settings, TABLES)
state["sheets"] = sheetlib.generate("choref", 5787, pag.default_page_sizes(len(built.weeks), 3),
                                    settings, TABLES, raw)
index = weeklib.week_index(state)
serials = list(index.keys())

# --- which week ---------------------------------------------------------------------------
first = serials[0]
R.equal("the index covers the weekday chart's weeks too", 29, len(serials))
R.equal("it is in date order", sorted(serials), serials)

# The week rolls over at midnight on Motzei Shabbos, so a Sunday already shows the coming
# week rather than the one just gone.
shabbos = date_from_serial(first)
R.equal("the Friday before shows that Shabbos", first,
        weeklib.current_serial(serials, date(shabbos.year, shabbos.month, shabbos.day - 1)))
R.equal("Shabbos itself still shows itself", first, weeklib.current_serial(serials, shabbos))
R.equal("the Sunday after shows the next week", serials[1],
        weeklib.current_serial(serials, date_from_serial(first + 1)))
R.equal("past the end it stays on the last week", serials[-1],
        weeklib.current_serial(serials, date_from_serial(serials[-1] + 30)))

# --- what is on the cards -------------------------------------------------------------------
cards = sheetlib.week_cards(first, state, settings, raw)
R.equal("a normal week has both cards", 2, len(cards))
R.equal("שבת first by default", ["פרשת בראשית", "זמני חול · פרשת בראשית"], [c.title for c in cards])
R.equal("and the order can be turned round", ["זמני חול · פרשת בראשית", "פרשת בראשית"],
        [c.title for c in sheetlib.week_cards(first, state, settings, raw, weekday_first=True)])
R.equal("the שבת card has a row per column", 8, len(cards[0].lines))
R.expect("the weekday card carries the שחרית schedule from settings",
         any("7:20*" in (line.value or "") for line in cards[1].lines), "")

# A week whose Shabbos is Yom Tov has no parsha and so no row on any Shabbos chart. Its
# weekday times are still real, so it shows its חול card alone rather than being dropped.
shabbos_serials = {int(w["serial"]) for s in state["sheets"] if s["season"] != "weekday" for w in s["weeks"]}
weekday_only = [s for s in serials if s not in shabbos_serials]
R.expect("a season has weeks the Shabbos chart cannot carry", bool(weekday_only), f"{len(weekday_only)}: {weekday_only}")
if weekday_only:
    alone = sheetlib.week_cards(weekday_only[0], state, settings, raw)
    R.equal("such a week shows its חול card alone", 1, len(alone))
    R.expect("named for the week rather than for the Yom Tov",
             alone[0].title.startswith("זמני חול · "), alone[0].title)

# A rule reaches the card the same way it reaches the chart.
hagadol = [s for s in serials if index[s][0].special_parsha == "הגדול"]
R.expect("the season has a שבת הגדול", bool(hagadol), "")
if hagadol:
    card = sheetlib.week_cards(hagadol[0], state, settings, raw)[0]
    mincha = next(line for line in card.lines if line.label == "מנחה")
    R.expect("and the דרשה rule is on its card", "דרשה" in mincha.value, repr(mincha.value)[-24:])

# And a hand typed cell wins over both.
sheet = next(s for s in state["sheets"] if s["season"] == "choref")
sheet["overrides"] = {str(first): {"C": "<u>1:40</u><br>נסיון"}}
typed = sheetlib.week_cards(first, state, settings, raw)[0]
R.equal("a hand typed cell reaches the card", "<u>1:40</u><br>נסיון",
        next(line.value for line in typed.lines if line.label == "מנחה"))
sheet["overrides"] = {}

# --- printing ---------------------------------------------------------------------------------
with tempfile.TemporaryDirectory() as tmp:
    chrome = sheetlib.chrome_of(raw)
    pair = write_card_pair_pdf(str(Path(tmp) / "pair.pdf"), sheetlib.week_cards(first, state, settings, raw), chrome)
    doc = fitz.open(pair)
    R.equal("both on one sheet is one landscape page", [(792, 612)],
            [(round(p.rect.width), round(p.rect.height)) for p in doc])
    text = doc[0].get_text()
    R.expect("with both cards on it", "פרשת בראשית" in text and "זמני חול" in text, "")

    run = [card for serial in serials[:4] for card in sheetlib.week_cards(serial, state, settings, raw)]
    rest = write_card_pdf(str(Path(tmp) / "rest.pdf"), run, chrome)
    doc = fitz.open(rest)
    R.equal("a run of weeks is a portrait page a card", [(612, 792)] * len(run),
            [(round(p.rect.width), round(p.rect.height)) for p in doc])
    R.expect("and no page is blank", all(p.get_text().strip() for p in doc), f"{len(doc)} pages")

sys.exit(0 if R.summary() else 1)
