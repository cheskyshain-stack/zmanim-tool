"""The printed chart's layout invariants, measured off the PDF rather than eyeballed.

A visual regression on paper is a real cost here, not a cosmetic one, and this project has
a history of confident conclusions about layout that turned out to be wrong. So every
assertion below is a measurement of the actual output:

  every page is exactly letter landscape, 792 by 612 points
  every body row on a page is the same height
  the header row is never shorter than a body row
  nothing is drawn outside the page margins
  the times on the page are exactly the times the engine produced, none lost or mangled

Run it with:

    python3 desktop/tests/test_chart_layout.py

Needs PySide6 and PyMuPDF. QT_QPA_PLATFORM is forced to offscreen, so it runs with no
display.
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

from zmanimboard.engine import pagination as pag, settings as settings_mod, tables as tables_mod  # noqa: E402
from zmanimboard.engine.fmt import UL_END, UL_START  # noqa: E402
from zmanimboard.engine.sheets import choref, common, kayitz, weekday, weeks as weeks_mod  # noqa: E402
from zmanimboard.render.chart import Chrome, ChartPage, SheetStyle  # noqa: E402
from zmanimboard.render.output import write_chart_pdf  # noqa: E402

S = settings_mod.resolve(settings_mod.DEFAULT_SETTINGS)
TABLES = tables_mod.load()
RAW = settings_mod.DEFAULT_SETTINGS

LETTER_LANDSCAPE = (792, 612)
TIME = re.compile(r"\d{1,2}:\d{2}")
# A hairline is drawn at the page's own resolution, so two grid lines that should be the
# same distance apart can differ by a fraction of a point purely from rounding.
TOLERANCE = 0.5


def build_pages(season: str, year: int):
    built = weeks_mod.compute_season_weeks(season, year, S, TABLES)
    sizes = pag.default_page_sizes(len(built.weeks), 3)
    pages = []
    for page_weeks in pag.split_weeks_into_pages(built.weeks, sizes):
        effective = season if season != "choref" else (
            "kayitz" if any(common.in_spring_dst_window(w.date, S) for w in page_weeks) else "choref"
        )
        build, columns = (kayitz.build_kayitz_row, kayitz.KAYITZ_COLUMNS) if effective == "kayitz" else \
                         (choref.build_choref_row, choref.CHOREF_COLUMNS)
        pages.append(ChartPage(
            weeks=page_weeks,
            rows={w.serial: build(w, S) for w in page_weeks},
            columns=columns,
            effective_season=effective,
        ))
    return pages


def build_weekday_pages(season: str, year: int):
    """The Weekday chart that goes with a season, its page breaks aligned onto the same
    dates as the Shabbos chart's so the two pair up page by page."""
    built = weeks_mod.compute_season_weeks(season, year, S, TABLES)
    wd = weeks_mod.compute_weekday_weeks(season, year, S, TABLES)
    sizes = pag.align_page_sizes_to(built.weeks, pag.default_page_sizes(len(built.weeks), 3), wd.weeks)
    schedule = RAW["weekdayShacharis"].replace("\n", "<br>")
    special = RAW["weekdayShacharisSpecial"].replace("\n", "<br>")
    merged = schedule + f'<br><br><u>{settings_mod.SPECIAL_SHACHARIS_HEADING}</u><br>' + special
    return [
        ChartPage(
            weeks=page_weeks,
            rows={w.serial: weekday.build_weekday_row(w, S) for w in page_weeks},
            columns=weekday.WEEKDAY_COLUMNS,
            effective_season="weekday",
            shacharis_html=merged,
        )
        for page_weeks in pag.split_weeks_into_pages(wd.weeks, sizes)
    ]


def chrome() -> Chrome:
    return Chrome(
        shul_name=RAW["shulName"], header_subtitle=RAW["headerSubtitle"],
        header_rabbi_line=RAW["headerRabbiLine"], footer_note=RAW["footerNote"],
        footer_address=RAW["footerAddress"],
    )


def horizontal_rules(pdf_page):
    """The y of every full width horizontal line, which is where the table's rows are."""
    ys = []
    for drawing in pdf_page.get_drawings():
        for item in drawing["items"]:
            if item[0] != "l":
                continue
            start, end = item[1], item[2]
            if abs(start.y - end.y) < 0.2 and abs(end.x - start.x) > 200:
                ys.append(round(start.y, 2))
    return sorted(set(ys))


def page_times(pdf_page):
    return Counter(TIME.findall(pdf_page.get_text()))


def expected_times(page: ChartPage):
    counts = Counter()
    for week in page.weeks:
        for key, _header in page.columns:
            counts.update(TIME.findall(page.rows[week.serial].get(key, "")))
    return counts


def strip_sentinels(text: str) -> str:
    return text.replace(UL_START, "").replace(UL_END, "")


class Report:
    def __init__(self):
        self.rows = []
        self.failed = False

    def expect(self, name, ok, detail=""):
        self.rows.append((name, bool(ok), detail))
        if not ok:
            self.failed = True

    def summary(self):
        width = max(len(name) for name, _, _ in self.rows)
        for name, ok, detail in self.rows:
            print(f"  {'ok  ' if ok else 'FAIL'} {name.ljust(width)}  {detail}")
        print(f"\n  {sum(1 for _, ok, _ in self.rows if ok)} of {len(self.rows)} checks passed.")
        return not self.failed


R = Report()

with tempfile.TemporaryDirectory() as tmp:
    jobs = [("choref", 5787, build_pages), ("kayitz", 5786, build_pages), ("weekday", 5787, lambda *_: build_weekday_pages("choref", 5787))]
    for season, year, make in jobs:
        pages = make(season, year)
        path = str(Path(tmp) / f"{season}-{year}.pdf")
        write_chart_pdf(path, pages, SheetStyle(accent_color=settings_mod.DEFAULT_ACCENT_COLOR), chrome())
        doc = fitz.open(path)
        tag = f"{season} {year}"

        R.expect(f"{tag}: page count", len(doc) == len(pages), f"{len(doc)} pages")

        for i, (pdf_page, page) in enumerate(zip(doc, pages), start=1):
            where = f"{tag} p{i}"
            size = (round(pdf_page.rect.width), round(pdf_page.rect.height))
            R.expect(f"{where}: letter landscape", size == LETTER_LANDSCAPE, f"{size[0]} x {size[1]} pt")

            rules = horizontal_rules(pdf_page)
            # One rule per row boundary: a header and n body rows share n + 2 edges.
            expected_rules = len(page.weeks) + 2
            R.expect(f"{where}: row boundaries", len(rules) == expected_rules,
                     f"{len(rules)}, expected {expected_rules}")
            if len(rules) == expected_rules:
                head_h = rules[1] - rules[0]
                body = [round(b - a, 2) for a, b in zip(rules[1:], rules[2:])]
                spread = max(body) - min(body)
                R.expect(f"{where}: body rows equal", spread <= TOLERANCE, f"spread {spread:.2f} pt, height {body[0]:.2f} pt")
                R.expect(f"{where}: header not shorter", head_h >= body[0] - TOLERANCE,
                         f"header {head_h:.2f} pt against body {body[0]:.2f} pt")
                # 0.35in top and bottom, which is 25.2pt.
                R.expect(f"{where}: table inside the margins", rules[0] >= 25.2 - TOLERANCE and rules[-1] <= 612 - 25.2 + TOLERANCE,
                         f"top {rules[0]:.1f}, bottom {rules[-1]:.1f}")

            got, want = page_times(pdf_page), expected_times(page)
            if page.shacharis_html:
                want += Counter(TIME.findall(re.sub(r"<[^>]+>", " ", page.shacharis_html)))
            R.expect(f"{where}: every time on the page", got == want,
                     f"{sum(want.values())} times" if got == want else f"missing {want - got}, extra {got - want}")

            parshiyos = [strip_sentinels(w.parsha) for w in page.weeks]
            text = pdf_page.get_text()
            missing = [p for p in parshiyos if p not in text]
            R.expect(f"{where}: every parsha on the page", not missing, f"{len(parshiyos)} names" if not missing else f"missing {missing}")

sys.exit(0 if R.summary() else 1)
