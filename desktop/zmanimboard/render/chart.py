"""Painting one page of a wall chart.

The page is a physical letter sheet, 11 by 8.5 inches landscape, and every measurement is
taken in inches against that. Nothing here scales to a window: a screen preview draws the
same page and then shrinks the result, exactly as the web version does with zoom, so what
is on the screen is the page.

The one piece of real logic is the row heights. See row_heights.
"""
import sys
from dataclasses import dataclass, field
from pathlib import Path

from PySide6.QtCore import QRectF, Qt
from PySide6.QtGui import QBrush, QColor, QFont, QFontMetricsF, QImage, QPen

from ..engine.fmt import UL_END, UL_START
from . import theme
from .fonts import load_bundled, stack_for
from .richtext import cell_html, engine_text_to_html, make_document, rtl_document, strip_lead_in


@dataclass(frozen=True)
class SheetStyle:
    font_family: str = "Times New Roman"
    font_size_pt: float = 10
    header_scale: float = 1.0
    accent_color: str = theme.mix("#c9ced5", "#c9ced5", 1.0)


@dataclass
class Chrome:
    """The header and footer, which come from settings and are the same on every page."""
    shul_name: str = ""
    header_subtitle: str = ""
    header_rabbi_line: str = ""
    footer_note: str = ""
    footer_address: str = ""
    icon_image: Path | None = None
    logo_image: Path | None = None


@dataclass
class ChartPage:
    """One printed page: the weeks on it, their built cells, and which chart it is."""
    weeks: list
    rows: dict                      # serial -> {column key: text}
    columns: list                   # [(key, header)] in workbook order, B first
    effective_season: str
    authored: dict = field(default_factory=dict)   # serial -> set of hand typed column keys
    ruled: dict = field(default_factory=dict)      # serial -> set of rule touched column keys
    shacharis_html: str = ""        # the Weekday chart's merged column, straight from settings
    english: bool = False


def _asset(name: str) -> Path:
    """Where a shipped image lives.

    Checked file by file rather than folder by folder. Asking whether the folder exists
    picked desktop/zmanimboard/assets, which does exist because the fonts are in it, and
    then found no images there: QImage returns a null image for a missing path and draws it
    as nothing, so the header simply had no logo and no building.
    """
    here = Path(__file__).resolve()
    bundle = getattr(sys, "_MEIPASS", None)
    roots = ([Path(bundle) / "assets"] if bundle else []) + [here.parent.parent / "assets", here.parents[3] / "assets"]
    for root in roots:
        if (root / name).exists():
            return root / name
    raise FileNotFoundError(f"{name} not found; looked in " + ", ".join(str(r) for r in roots))


def visual_columns(page: ChartPage):
    """The columns left to right, as they come out on paper: the workbook's own B to L
    order, with the parsha column at the right hand end.

    Worth spelling out, because the web version arrives here by a route that looks like the
    opposite. Its markup reverses the column list and puts the parsha cell first, then hands
    the table dir="rtl", which flips the whole thing back: the first cell in the markup
    renders at the right. The two reversals cancel, and the printed order is the same in
    Hebrew and in English.

    What the reversal is for is the reading order. Read right to left, starting at the
    parsha, the row runs forward through the week: Friday's Mincha and candle lighting
    first, Motzei Shabbos Maariv last. The workbook's own B to L order is the reverse of
    that, latest event first.
    """
    return list(page.columns)


def row_heights(table_height: float, head_natural: float, body_count: int):
    """Every row the same height, header included.

    Left alone the header always comes out shorter: the table stretches to fill the page and
    the extra height is handed out in proportion to each row's natural content, which for the
    header is one short line. Pinning the header to a measured body row does not settle it
    either, the total being fixed: growing the header shrinks the rows it was just matched
    against.

    So the table's height is split evenly across all its rows, which is stable in one pass.
    There are two cases and the table has to come out exactly its own height either way:

        header fits in an equal share  -> every row, header included, takes that share
        header needs more than a share -> it keeps its height, the rest split what is left

    One formula for both overflowed the page: the first case pushed a tall header down to a
    share it could not fit in, the second handed a short header more than it needed.
    """
    rows = body_count + 1
    even_share = table_height / rows
    if head_natural <= even_share:
        return even_share, even_share
    return head_natural, (table_height - head_natural) / body_count


class ChartPainter:
    def __init__(self, painter, style: SheetStyle, chrome: Chrome):
        load_bundled()
        self.p = painter
        self.style = style
        self.chrome = chrome
        self.dpi = painter.device().logicalDpiX()
        self.device = painter.device()
        self.families = stack_for(style.font_family)
        self.accent = style.accent_color
        self.head_ink = theme.header_ink(self.accent)
        self.band = theme.band_color(self.accent)

    # inches to device units
    def u(self, inches: float) -> float:
        return inches * self.dpi

    def pt(self, points: float) -> float:
        return points * theme.PT * self.dpi

    def _doc(self, html_text, size_pt, width, color=theme.INK, align=Qt.AlignHCenter, rtl=False, line_height=None):
        make = rtl_document if rtl else make_document
        return make(
            html_text,
            families=self.families,
            point_size=size_pt,
            color=color,
            width=width,
            align=align,
            line_height=line_height,
            device=self.device,
        )

    def _draw_doc(self, doc, x, y):
        self.p.save()
        self.p.translate(x, y)
        doc.drawContents(self.p)
        self.p.restore()

    def _plain(self, text: str) -> str:
        """A cell's text with the underline sentinels taken out, for measuring."""
        return strip_lead_in(str(text or "")).replace(UL_START, "").replace(UL_END, "")

    def _natural_width(self, text: str, size_pt: float) -> float:
        font = QFont()
        font.setFamilies(self.families)
        font.setPointSizeF(size_pt)
        font.setBold(True)
        metrics = QFontMetricsF(font, self.device)
        return max((metrics.horizontalAdvance(line) for line in self._plain(text).split("\n")), default=0.0)

    # --- the page ---------------------------------------------------------------------
    def paint(self, page: ChartPage):
        g = theme.CHART
        self.p.fillRect(QRectF(0, 0, self.u(g.width), self.u(g.height)), QColor(theme.PAPER))

        left = self.u(g.pad_side)
        right = self.u(g.width - g.pad_side)
        top = self.u(g.pad_top)
        bottom = self.u(g.height - g.pad_top)
        width = right - left

        header_bottom = self._paint_header(left, top, width)
        footer_top = self._paint_footer(left, bottom, width)
        self._paint_table(page, left, header_bottom + self.u(g.header_gap), width, footer_top - self.u(g.footer_gap))

    def _paint_header(self, left, top, width) -> float:
        g, c = theme.CHART, self.chrome
        scale = self.style.header_scale
        base = self.style.font_size_pt

        icon_h = self.u(g.icon_height * scale)
        logo_h = self.u(g.logo_height * scale)
        icon = QImage(str(c.icon_image or _asset("logo-building-icon.png")))
        logo = QImage(str(c.logo_image or _asset("logo-text.png")))
        if icon.isNull() or logo.isNull():
            raise RuntimeError("the header images did not load")

        rabbi_width = width * 0.22
        rabbi = self._doc(engine_text_to_html(c.header_rabbi_line), base, rabbi_width,
                          align=Qt.AlignRight, rtl=True, line_height=1.3)

        icon_w = icon_h * (icon.width() / icon.height()) if icon.height() else 0
        centre_top = top
        blocks = [icon_h, logo_h, rabbi.size().height()]

        subtitle = None
        if c.header_subtitle:
            subtitle = self._doc(engine_text_to_html(c.header_subtitle), base + 1.5, width * 0.5, rtl=True)
            blocks[1] = logo_h + self.u(1 * theme.PT) + subtitle.size().height()
        header_h = max(blocks)

        # Icon on the left, rabbi line on the right, logo and subtitle centred between.
        self.p.drawImage(QRectF(left, centre_top + (header_h - icon_h) / 2, icon_w, icon_h), icon)
        logo_w = logo_h * (logo.width() / logo.height()) if logo.height() else 0
        centre_x = left + width / 2
        centre_block_h = blocks[1]
        y = centre_top + (header_h - centre_block_h) / 2
        self.p.drawImage(QRectF(centre_x - logo_w / 2, y, logo_w, logo_h), logo)
        if subtitle is not None:
            self._draw_doc(subtitle, centre_x - subtitle.textWidth() / 2, y + logo_h + self.u(1 * theme.PT))
        self._draw_doc(rabbi, left + width - rabbi_width, centre_top + (header_h - rabbi.size().height()) / 2)
        return centre_top + header_h

    def _paint_footer(self, left, bottom, width) -> float:
        g, c = theme.CHART, self.chrome
        base = self.style.font_size_pt
        note = self._doc(engine_text_to_html(c.footer_note), base - 2.5, width * 0.6,
                         color=theme.FOOTER_INK, line_height=1.3) if c.footer_note else None
        address = self._doc(engine_text_to_html(c.footer_address), base + 3, width * 0.6)
        block_h = (note.size().height() if note else 0) + self.u(2 * theme.PT) + address.size().height()
        y = bottom - block_h
        centre_x = left + width / 2
        if note:
            self._draw_doc(note, centre_x - note.textWidth() / 2, y)
        self._draw_doc(address, centre_x - address.textWidth() / 2, bottom - address.size().height())

        # The hairline either side of the footer text, on the middle of the block.
        rule_y = y + block_h / 2
        pen = QPen(QColor(theme.GRID_COLOR))
        pen.setWidthF(self.u(theme.PX))
        self.p.setPen(pen)
        text_half = max(note.idealWidth() if note else 0, address.idealWidth()) / 2 + self.u(g.footer_rule_gap)
        self.p.drawLine(left, rule_y, centre_x - text_half, rule_y)
        self.p.drawLine(centre_x + text_half, rule_y, left + width, rule_y)
        return y

    def _column_widths(self, page: ChartPage, columns, width):
        """How wide each column comes out.

        The web version leaves this to the browser's automatic table layout, which shares
        surplus width out in proportion to how much content a column holds. This does the
        same thing directly: measure each column's widest single line, then hand out
        whatever is left over in proportion.

        The parsha column carries a floor so it cannot be crushed. On a קיץ page, twelve
        columns against חורף's nine, it was being squeezed to about 59px while the same
        column on a חורף page sat at a comfortable 86px, leaving a name like "כי תשא" a few
        pixels of margin. The floor only lifts the tight pages to match the roomy ones; a
        genuinely long name still widens the column past it.
        """
        g = theme.CHART
        base = self.style.font_size_pt
        pad = 2 * self.u(g.cell_pad_x)

        if page.effective_season == "weekday":
            # table-layout: fixed on the Weekday chart: the parsha column takes a fixed
            # share and שחרית, מנחה and מעריב split the rest equally between themselves.
            parsha = width * g.weekday_parsha_fraction
            each = (width - parsha) / len(columns)
            return parsha, [each] * len(columns)

        natural = []
        for key, header in columns:
            widest = self._natural_width(header, base + 2)
            for week in page.weeks:
                widest = max(widest, self._natural_width(page.rows.get(week.serial, {}).get(key, ""), base))
            natural.append(widest + pad)

        parsha_natural = max(
            [self._natural_width(self._parsha_text(week), base + 2) + pad for week in page.weeks] or [0]
        )
        parsha_floor = self.pt(base) * g.parsha_min_width_em
        parsha = max(parsha_natural, parsha_floor)

        total = sum(natural) + parsha
        if total <= 0:
            return parsha, natural
        surplus = width - total
        if surplus > 0:
            share = [n / total for n in natural] + [parsha / total]
            natural = [n + surplus * s for n, s in zip(natural, share[:-1])]
            parsha = parsha + surplus * share[-1]
        else:
            # Over budget: shrink everything proportionally, leaving the parsha floor alone
            # so the names stay readable and the times wrap instead.
            room = width - parsha
            scale = room / sum(natural)
            natural = [n * scale for n in natural]
        return parsha, natural

    def _parsha_text(self, week) -> str:
        from ..engine.hebrew_calendar import week_of_label
        text = week_of_label(week.parsha, False)
        return text + ("\n" + week.special_parsha if week.special_parsha else "")

    def _paint_table(self, page: ChartPage, left, top, width, bottom):
        g = theme.CHART
        base = self.style.font_size_pt
        columns = visual_columns(page)
        is_weekday = page.effective_season == "weekday"
        parsha_w, col_w = self._column_widths(page, columns, width)
        widths = col_w + [parsha_w]

        table_h = bottom - top
        head_natural = self._head_natural_height(page, columns, col_w)
        head_h, body_h = row_heights(table_h, head_natural, len(page.weeks))

        # Header row.
        x = left
        self.p.fillRect(QRectF(left, top, width, head_h), QColor(self.accent))
        headers = [h for _k, h in columns] + [self._parsha_header(page)]
        for w, header in zip(widths, headers):
            self._draw_cell(engine_text_to_html(header), x, top, w, head_h, base + 2, color=self.head_ink, rtl=True)
            x += w
        self._grid_row(left, top, widths, head_h)

        # Body rows.
        merged_span = self._merged_span(page, widths, left)
        y = top + head_h
        for index, week in enumerate(page.weeks):
            if index % 2 == 1:
                self.p.fillRect(QRectF(left, y, width, body_h), QColor(self.band))
            x = left
            cells = self._row_cells(page, week, columns, index)
            for w, (text, size, rtl, _authored) in zip(widths, cells):
                if text is not None:
                    self._draw_cell(text, x, y, w, body_h, size, rtl=rtl)
                x += w
            # No separator across the merged column, except under the last row, which is
            # the bottom of the table itself.
            gap = merged_span if index > 0 else None
            self._grid_row(left, y, widths, body_h, top_gap=gap,
                           bottom_gap=merged_span if index < len(page.weeks) - 1 else None)
            y += body_h

        # The merged שחרית column on the Weekday chart: one shul wide value spanning every
        # row on the page rather than repeated in each, matching the printed board.
        if is_weekday and page.shacharis_html:
            self._draw_merged_shacharis(page, left, top + head_h, widths, columns, body_h * len(page.weeks))

    def _parsha_header(self, page: ChartPage) -> str:
        """The Weekday chart titles its parsha column, matching the printed board; the
        Shabbos charts leave that corner blank."""
        if page.effective_season == "weekday":
            return "Weekday\nזמנים"
        return "Parsha" if page.english else " "

    def _row_cells(self, page: ChartPage, week, columns, index):
        base = self.style.font_size_pt
        authored = page.authored.get(week.serial, set())
        row = page.rows.get(week.serial, {})
        out = []
        for key, _header in columns:
            if page.effective_season == "weekday" and key == "E":
                out.append((None, base, False, False))  # drawn once, merged, below
                continue
            out.append((cell_html(row.get(key, ""), key in authored), base, False, key in authored))
        return out + [(engine_text_to_html(self._parsha_text(week)), base + 2, True, False)]

    def _merged_span(self, page: ChartPage, widths, left):
        """The x range the merged שחרית cell covers, so the row separators can stop short of
        it and the column reads as one tall cell rather than as ten stacked ones."""
        if page.effective_season != "weekday" or not page.shacharis_html:
            return None
        keys = [k for k, _h in visual_columns(page)]
        if "E" not in keys:
            return None
        at = keys.index("E")
        x = left + sum(widths[:at])
        return x, x + widths[at]

    def _draw_merged_shacharis(self, page, left, top, widths, columns, height):
        keys = [k for k, _h in columns]
        at = keys.index("E")
        x = left + sum(widths[:at])
        self._draw_cell(page.shacharis_html, x, top, widths[at], height, self.style.font_size_pt, line_height=1.3)

    def _head_natural_height(self, page, columns, col_w) -> float:
        g = theme.CHART
        base = self.style.font_size_pt
        tallest = 0.0
        for (key, header), w in zip(columns, col_w):
            doc = self._doc(engine_text_to_html(header), base + 2, w - 2 * self.u(g.cell_pad_x), rtl=True, line_height=1.2)
            tallest = max(tallest, doc.size().height())
        return tallest + 2 * self.u(g.cell_pad_y)

    def _draw_cell(self, html_text, x, y, w, h, size_pt, *, color=theme.INK, rtl=False, line_height=None):
        g = theme.CHART
        inner_w = w - 2 * self.u(g.cell_pad_x)
        if inner_w <= 0:
            return
        doc = self._doc(html_text, size_pt, inner_w, color=color, rtl=rtl,
                        line_height=line_height if line_height is not None else (1.15 if rtl else 1.2))
        text_h = doc.size().height()
        self.p.save()
        self.p.setClipRect(QRectF(x, y, w, h))
        self._draw_doc(doc, x + self.u(g.cell_pad_x), y + max(0.0, (h - text_h) / 2))
        self.p.restore()

    def _grid_row(self, left, y, widths, height, top_gap=None, bottom_gap=None):
        """One row's box. top_gap and bottom_gap are x ranges the horizontal line skips,
        which is how a merged cell reads as one cell."""
        pen = QPen(QColor(theme.GRID_COLOR))
        pen.setWidthF(self.u(theme.PX))
        pen.setCosmetic(False)
        self.p.setPen(pen)
        total = sum(widths)
        self._h_line(left, left + total, y, top_gap)
        self._h_line(left, left + total, y + height, bottom_gap)
        x = left
        for w in widths:
            self.p.drawLine(x, y, x, y + height)
            x += w
        self.p.drawLine(left + total, y, left + total, y + height)

    def _h_line(self, x0, x1, y, gap):
        if gap is None:
            self.p.drawLine(x0, y, x1, y)
            return
        a, b = gap
        self.p.drawLine(x0, y, a, y)
        self.p.drawLine(b, y, x1, y)
