"""The week card: how its times are broken across lines, and what comes out on paper.

The line work is checked as plain string transforms, which needs no graphics stack at all,
and then the finished card is rendered and measured the same way the chart is.

    python3 desktop/tests/test_card_layout.py
"""
import os
import re
import sys
import tempfile
from collections import Counter
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "desktop"))

import fitz  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

_app = QApplication.instance() or QApplication([])

from zmanimboard.engine import settings as settings_mod, tables as tables_mod  # noqa: E402
from zmanimboard.engine.fmt import UL_END, UL_START  # noqa: E402
from zmanimboard.engine.sheets import weeks as weeks_mod  # noqa: E402
from zmanimboard.engine.util import NBSP  # noqa: E402
from zmanimboard.render.chart import Chrome  # noqa: E402
from zmanimboard.render.lines import cap_html_times_per_line, cap_times_per_line, sizes_for  # noqa: E402
from zmanimboard.render.output import write_card_pdf  # noqa: E402
from zmanimboard.render.weekcards import shabbos_card, weekday_card  # noqa: E402

S = settings_mod.resolve(settings_mod.DEFAULT_SETTINGS)
TABLES = tables_mod.load()
RAW = settings_mod.DEFAULT_SETTINGS
LETTER_PORTRAIT = (612, 792)
TIME = re.compile(r"\d{1,2}:\d{2}")

U, E, NB = UL_START, UL_END, NBSP
SLASH = f"{NB}/{NB}"


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

# --- how many to a line -----------------------------------------------------------------
R.equal("sizes_for: seven at two a line", [1, 2, 2, 2], sizes_for(7, 2))
R.equal("sizes_for: four at three a line", [2, 2], sizes_for(4, 3))
R.equal("sizes_for: three at two a line", [1, 2], sizes_for(3, 2))
R.equal("sizes_for: none", [], sizes_for(0, 2))

# A מנחה ערב שבת in winter: the workbook writes three times then four, and laying the seven
# out afresh gives the shorter line first so the block builds downwards.
seven = f"12:30{SLASH}1:00{SLASH}1:15\n1:35{SLASH}1:50{SLASH}2:15{SLASH}3:00"
R.equal("winter מנחה ערב שבת re-flows to 1, 2, 2, 2",
        f"12:30\n1:00{SLASH}1:15\n1:35{SLASH}1:50\n2:15{SLASH}3:00",
        cap_times_per_line(seven, 2))

# A cell carrying a word keeps its own breaks rather than being run together, so
# "שקיעה 6:26" is never joined onto the line above it.
R.equal("a cell with a word keeps its own lines",
        f"6:08\nשקיעה{NB}6:26", cap_times_per_line(f"6:08\nשקיעה{NB}6:26", 2))

# The break goes outside the underline, never between the sentinel and its own text.
R.equal("a break lands outside an underline",
        f"1:15\n{U}{NB}1:35{E}", cap_times_per_line(f"1:15{SLASH}{U}{NB}1:35{E}", 1))

# --- authored markup ----------------------------------------------------------------------
R.equal("the everyday שחרית, one time a line",
        ['<span class="big">7:00</span>', '<span class="big">7:20*</span>',
         '<span class="big"><u>7:35</u></span>', '<span class="big">8:00</span>',
         '<span class="big">8:20*</span>', '<span class="big"><u>8:40</u></span>'],
        cap_html_times_per_line(RAW["weekdayShacharis"].replace("\n", "<br>"), 1))

# The hand typed מנחה of 19 September, exactly as it is stored in the published file. Its
# second line is wrapped in a <div>, which is a line break as much as a <br> is.
drasha = '1:40 / <u> 4:45</u><div><u><span style="font-size: 13.3333px;">דרשה 5:15</span><br></u>6:14 / <u> 6:29</u><br></div>'
R.equal("a hand typed cell keeps its own three lines",
        ['1:40 / <u> 4:45</u>',
         '<div><u><span style="font-size: 13.3333px;">דרשה 5:15</span></u></div>',
         '<div>6:14 / <u> 6:29</u></div>'],
        cap_html_times_per_line(drasha, 2))

# --- the printed card ---------------------------------------------------------------------
def card_times(card):
    counts = Counter()
    for line in card.lines:
        counts.update(TIME.findall(re.sub(r"<[^>]+>", "", line.value or "")))
    return counts


with tempfile.TemporaryDirectory() as tmp:
    chrome = Chrome(shul_name=RAW["shulName"], header_subtitle=RAW["headerSubtitle"],
                    header_rabbi_line=RAW["headerRabbiLine"], footer_address=RAW["footerAddress"])
    for season, year in (("choref", 5787), ("kayitz", 5786)):
        built = weeks_mod.compute_season_weeks(season, year, S, TABLES)
        weekday_weeks = {w.serial: w for w in weeks_mod.compute_weekday_weeks(season, year, S, TABLES).weeks}
        # First, middle and last week of the season, so a page that flips to a קיץ chart and
        # a week with a special Shabbos are both in the run.
        picks = [built.weeks[0], built.weeks[len(built.weeks) // 2], built.weeks[-1]]
        cards = []
        for week in picks:
            cards.append(shabbos_card(week, season, S, RAW))
            if week.serial in weekday_weeks:
                cards.append(weekday_card(weekday_weeks[week.serial], S, RAW))

        path = str(Path(tmp) / f"cards-{season}-{year}.pdf")
        write_card_pdf(path, cards, chrome)
        doc = fitz.open(path)
        tag = f"{season} {year}"
        R.expect(f"{tag}: one page a card", len(doc) == len(cards), f"{len(doc)} pages for {len(cards)} cards")

        for i, (pdf_page, card) in enumerate(zip(doc, cards), start=1):
            where = f"{tag} card {i}"
            size = (round(pdf_page.rect.width), round(pdf_page.rect.height))
            R.expect(f"{where}: letter portrait", size == LETTER_PORTRAIT, f"{size[0]} x {size[1]} pt")

            got, want = Counter(TIME.findall(pdf_page.get_text())), card_times(card)
            R.expect(f"{where}: every time on the card", got == want,
                     f"{sum(want.values())} times" if got == want else f"missing {want - got}, extra {got - want}")

            # Nothing may spill past the page: a card is a page and the whole bargain is that
            # what is on the screen is what comes out.
            blocks = [b for b in pdf_page.get_text("blocks") if b[4].strip()]
            lowest = max(b[3] for b in blocks)
            highest = min(b[1] for b in blocks)
            R.expect(f"{where}: nothing past the edges", highest >= 0 and lowest <= 792,
                     f"top {highest:.1f}, bottom {lowest:.1f}")
            R.expect(f"{where}: the address is the last thing", lowest <= 792 - 0.5 * 72 + 6,
                     f"bottom {lowest:.1f} pt against a 0.5in margin")

sys.exit(0 if R.summary() else 1)
