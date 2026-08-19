"""Painting one week card: letter portrait, one week to a page, meant to be read off a
board rather than studied at a desk.

The rows are drawn line by line rather than as one laid out block per cell. That is what
makes the colon axis possible: a line whose hour is one digit is simply started a digit's
width further in, which is exact in any font, where the web version has to insert an
element sized in ch and hope the face cooperates.
"""
from dataclasses import dataclass, field

from PySide6.QtCore import QRectF, Qt
from PySide6.QtGui import QColor, QFont, QFontMetricsF, QImage, QPen

from ..engine.fmt import UL_END, UL_START
from . import theme
from .chart import _asset
from .fonts import load_bundled, stack_for
from .lines import (
    cap_html_times_per_line,
    cap_times_per_line,
    format_label,
    has_two_digit_hour_at_line_start,
    has_underline,
    marks_used,
    needs_pad,
)
from .richtext import engine_text_to_html, make_document

ROW_BG = "#f1f2f5"
ROW_RADIUS = 6 / 96  # 6px, in inches
MAX_GROW = 1.6  # past this the times are billboard sized rather than well set


@dataclass
class CardLine:
    """One row of the card: a name on the right, its times on the left."""
    label: str                  # plain text, or markup when label_html is set
    value: str                  # engine text with sentinels, or markup when value_is_html
    value_is_html: bool = False
    label_html: str = ""
    keep_empty: bool = False


@dataclass
class WeekCard:
    title: str
    lines: list
    is_weekday: bool = False
    footer_address: str = ""
    legend: list = field(default_factory=list)   # [(direction, text)]


def build_legend(card: WeekCard):
    """The key to the symbols, carrying only the lines the card actually uses.

    A card is a page on its own, so it has to say what its own marks mean, but saying all
    three every time would explain marks that are not on it: a week whose מנינים are all in
    the main בית מדרש has no underline to explain, and באולם השמחות only appears on a week
    that has a second שחרית.

    The star lines are set right to left so the star sits at the right hand end, against
    the Hebrew it belongs to, the same way round as the printed chart's footer. The first
    line is mostly English and is set the other way.
    """
    everything = "\n".join(line.value for line in card.lines)
    out = []
    if has_underline(everything) or "<u>" in everything:
        out.append(("ltr", "All underlined מנינים will be בבית מדרש למטה"))
    marks = marks_used(everything)
    stars = []
    if "*" in marks:
        stars.append("*בעזרת נשים")
    if "**" in marks:
        stars.append("**באולם השמחות")
    if stars:
        out.append(("rtl", " ".join(stars)))
    return out


class CardPainter:
    def __init__(self, painter, chrome, font_family: str = "Times New Roman"):
        load_bundled()
        self.p = painter
        self.chrome = chrome
        self.device = painter.device()
        self.dpi = painter.device().logicalDpiX()
        self.families = stack_for(font_family)

    def u(self, inches: float) -> float:
        return inches * self.dpi

    def _doc(self, html_text, size_pt, width, *, color=theme.INK, align=Qt.AlignLeft, rtl=False, bold=True, line_height=None):
        return make_document(
            html_text, families=self.families, point_size=size_pt, color=color, width=width,
            align=align, bold=bold, line_height=line_height, device=self.device, rtl=rtl,
            # The everyday שחרית is stored wrapped in class="big", which sets it a third
            # larger than the ר"ח block on the wall chart. A card gives the two their own
            # labelled rows, so the size difference would say nothing here and the card
            # cancels it, the same way .week-card .big does in the stylesheet.
            big_scale=1.0,
        )

    def _draw(self, doc, x, y):
        self.p.save()
        self.p.translate(x, y)
        doc.drawContents(self.p)
        self.p.restore()

    def _digit_width(self, size_pt: float) -> float:
        font = QFont()
        font.setFamilies(self.families)
        font.setPointSizeF(size_pt)
        font.setBold(True)
        return QFontMetricsF(font, self.device).horizontalAdvance("0")

    # --- the page ---------------------------------------------------------------------
    def paint(self, card: WeekCard):
        g = theme.CARD
        self.p.fillRect(QRectF(0, 0, self.u(g.width), self.u(g.height)), QColor(theme.PAPER))
        left = self.u(g.pad_side)
        width = self.u(g.width - 2 * g.pad_side)
        top = self.u(g.pad_top)
        bottom = self.u(g.height - g.pad_bottom)

        header_bottom = self._paint_header(left, top, width)

        title = self._doc(engine_text_to_html(card.title), theme.CARD_TITLE_PT, width, align=Qt.AlignHCenter, rtl=True)
        title_y = header_bottom + self.u(g.title_gap)
        self._draw(title, left, title_y)

        foot_top = self._paint_foot(card, left, bottom, width)
        lines_top = title_y + title.size().height() + self.u(g.lines_gap)
        self._paint_lines(card, left, lines_top, width, foot_top)

    def _paint_header(self, left, top, width) -> float:
        """The same header the wall chart carries, at this narrower page's scale, rather
        than a second one that looks similar."""
        g, c = theme.CARD, self.chrome
        scale = g.header_scale
        base = theme.CARD_BASE_PT
        icon_h = self.u(theme.CHART.icon_height * scale)
        logo_h = self.u(theme.CHART.logo_height * scale)
        icon = QImage(str(c.icon_image or _asset("logo-building-icon.png")))
        logo = QImage(str(c.logo_image or _asset("logo-text.png")))

        rabbi_width = width * 0.3
        rabbi = self._doc(engine_text_to_html(c.header_rabbi_line), base, rabbi_width, align=Qt.AlignRight, rtl=True, line_height=1.3)
        subtitle = self._doc(engine_text_to_html(c.header_subtitle), base + 1.5, width * 0.6, align=Qt.AlignHCenter, rtl=True) if c.header_subtitle else None

        centre_h = logo_h + (self.u(1 * theme.PT) + subtitle.size().height() if subtitle else 0)
        header_h = max(icon_h, centre_h, rabbi.size().height())

        icon_w = icon_h * (icon.width() / icon.height()) if icon.height() else 0
        logo_w = logo_h * (logo.width() / logo.height()) if logo.height() else 0
        centre_x = left + width / 2
        self.p.drawImage(QRectF(left, top + (header_h - icon_h) / 2, icon_w, icon_h), icon)
        y = top + (header_h - centre_h) / 2
        self.p.drawImage(QRectF(centre_x - logo_w / 2, y, logo_w, logo_h), logo)
        if subtitle:
            self._draw(subtitle, centre_x - subtitle.textWidth() / 2, y + logo_h + self.u(1 * theme.PT))
        self._draw(rabbi, left + width - rabbi_width, top + (header_h - rabbi.size().height()) / 2)
        return top + header_h

    def _paint_foot(self, card: WeekCard, left, bottom, width) -> float:
        """The key and the address, at the foot of the page. Returns the top of the block,
        which is where the rows have to stop."""
        g = theme.CARD
        address = self._doc(engine_text_to_html(card.footer_address), theme.CARD_FOOT_PT, width, align=Qt.AlignHCenter)
        y = bottom - address.size().height()
        self._draw(address, left, y)

        legend = card.legend or build_legend(card)
        for direction, text in reversed(legend):
            doc = self._doc(engine_text_to_html(text), theme.CARD_LEGEND_PT, width,
                            color=theme.FOOTER_INK, align=Qt.AlignHCenter, rtl=direction == "rtl", line_height=1.35)
            y -= doc.size().height()
            self._draw(doc, left, y)
        if legend:
            y -= self.u(g.legend_gap)
        return y - self.u(g.foot_gap)

    # --- the rows ---------------------------------------------------------------------
    def _prepared(self, card: WeekCard):
        """Each row's label and its times, with the times already broken to the right
        number to a line.

        Two to a line on the שבת card and one on the weekday card. The weekday card carries
        only three minyanim against a full sheet, so a time to a line is what fills it; the
        שבת card has eleven rows and would run off the page the same way. Keyed on which
        card it is rather than on how many rows it has: a Yom Tov week has no שבת card, and
        going by position gave its חול card the שבת card's own count.
        """
        per_line = 1 if card.is_weekday else 2
        rows = []
        for line in card.lines:
            value = line.value or ""
            if not value.strip() and not line.keep_empty:
                continue
            text = value if line.value_is_html else cap_times_per_line(value, per_line)
            # Authored markup is capped too. The web version applies the cap to every row,
            # the שחרית schedule included, which is what puts one time to a line on the
            # weekday card rather than a single long run.
            rows.append((line, text))
        return rows

    def _value_lines(self, line: CardLine, text: str, per_line: int):
        """A row's times, one entry per printed line, as markup."""
        if line.value_is_html:
            return cap_html_times_per_line(text, per_line)
        return [engine_text_to_html(part) for part in text.split("\n")]

    def _measure_rows(self, card: WeekCard, rows, width, scale: float):
        g = theme.CARD
        per_line = 1 if card.is_weekday else 2
        pad_x = self.u(g.line_pad_x) * scale
        content = width - 2 * pad_x
        label_w = content * 0.4
        time_w = content * 0.4
        pad_y = self.u(g.line_pad_y) * scale
        gap = self.u(g.line_gap) * scale
        time_pt = theme.CARD_TIME_PT * scale
        label_pt = theme.CARD_LABEL_PT * scale
        out, total = [], 0.0
        for line, text in rows:
            label_html = line.label_html or engine_text_to_html(format_label(line.label))
            label_doc = self._doc(label_html, label_pt, label_w, align=Qt.AlignRight, rtl=True)
            value_lines = self._value_lines(line, text, per_line)
            line_h = self._time_line_height(time_pt)
            body_h = max(label_doc.size().height(), line_h * max(1, len(value_lines)))
            height = body_h + 2 * pad_y
            out.append((label_doc, value_lines, height, line_h))
            total += height + gap
        return out, (total - gap if out else 0.0)

    def _time_line_height(self, time_pt: float) -> float:
        font = QFont()
        font.setFamilies(self.families)
        font.setPointSizeF(time_pt)
        font.setBold(True)
        return QFontMetricsF(font, self.device).height() * 1.35

    def _paint_lines(self, card: WeekCard, left, top, width, bottom):
        """The rows, scaled to the room they have.

        Shrunk when a long week would run past the bottom of the page, and grown when a
        short weekday card would otherwise stop two thirds down the sheet, which on a wall
        reads as a page that failed to finish rather than as a short list. Growing must not
        widen the block, so the measure is divided by the same factor: with the block left
        at full width the weekday card's rows spanned the page while the שבת card's stayed
        narrow, and a pair of cards meant to match did not.
        """
        g = theme.CARD
        rows = self._prepared(card)
        if not rows:
            return
        room = bottom - top
        measure = min(self.u(g.measure), width)

        prepared, natural = self._measure_rows(card, rows, measure, 1.0)
        scale = 1.0
        if natural > room:
            scale = max(0.5, (room / natural) * 0.98)
        elif natural > 0:
            grow = min((room / natural) * 0.98, MAX_GROW)
            # Bigger type at a constant width can push a line into wrapping, which makes the
            # block taller than the growth assumed, so the result is measured and eased back
            # rather than trusted first time.
            while grow > 1.02:
                _rows, height = self._measure_rows(card, rows, measure, grow)
                if height <= room:
                    scale = grow
                    break
                grow -= 0.05
        prepared, total = self._measure_rows(card, rows, measure, scale)

        pad_x = self.u(g.line_pad_x) * scale
        pad_y = self.u(g.line_pad_y) * scale
        gap = self.u(g.line_gap) * scale
        time_pt = theme.CARD_TIME_PT * scale
        radius = self.u(ROW_RADIUS) * scale
        content = measure - 2 * pad_x
        label_w = content * 0.4
        time_w = content * 0.4
        block_left = left + (width - measure) / 2

        # One colon axis for the whole card rather than one per row.
        every_line = "\n".join("\n".join(_strip_markup(v) for v in value_lines) for _l, value_lines, _h, _lh in prepared)
        align = has_two_digit_hour_at_line_start(every_line)
        digit = self._digit_width(time_pt)

        y = top
        for (label_doc, value_lines, height, line_h) in prepared:
            self.p.setPen(Qt.NoPen)
            self.p.setBrush(QColor(ROW_BG))
            self.p.drawRoundedRect(QRectF(block_left, y, measure, height), radius, radius)
            self.p.setBrush(Qt.NoBrush)

            label_h = label_doc.size().height()
            self._draw(label_doc, block_left + measure - pad_x - label_w, y + (height - label_h) / 2)

            times_h = line_h * max(1, len(value_lines))
            ty = y + (height - times_h) / 2
            for value in value_lines:
                doc = self._doc(value, time_pt, time_w, align=Qt.AlignLeft, line_height=1.35)
                offset = digit if (align and needs_pad(_strip_markup(value))) else 0
                self._draw(doc, block_left + pad_x + offset, ty)
                ty += line_h
            y += height + gap


def _strip_markup(html_text: str) -> str:
    import re
    return re.sub(r"<[^>]+>", "", str(html_text or "")).replace(UL_START, "").replace(UL_END, "")
