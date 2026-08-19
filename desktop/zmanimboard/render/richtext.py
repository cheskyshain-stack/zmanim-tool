"""Turning an engine string, or a hand typed cell, into something Qt can draw.

The engine builds every cell as plain text carrying two Private Use Area sentinels around
anything underlined, plus newlines. A hand typed override, imported from a backup made in
the web version, is instead a fragment of HTML with <u>, <br>, <div> and an inline
font-size in it. Both end up as HTML for a QTextDocument here, which is what gives us bidi,
underlining and line breaks without writing a text layout engine.

The one transformation that is not obvious is the whitespace strip. See strip_lead_in.
"""
import html
import re

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QFont, QTextDocument, QTextOption

from ..engine.fmt import UL_START, UL_END

_LEAD_IN = re.compile(f"{UL_START}\\s+")


def strip_lead_in(text: str) -> str:
    """Drops the whitespace immediately after an underline sentinel.

    underline_time writes a no-break space there, the workbook's lead-in, meant not to show
    on a centred chart cell. It does show: a cell holding several times left about 13.7px
    in front of an underlined one against 10.36px in front of a plain one, and the rule
    itself started a space before its own first digit. Dropped here rather than in the
    engine, so the engine stays a faithful port and every renderer makes the same choice.
    """
    return _LEAD_IN.sub(UL_START, text)


def engine_text_to_html(text: str) -> str:
    """A computed cell: escape it, then turn the sentinels and newlines into markup."""
    escaped = html.escape(strip_lead_in(str(text or "")), quote=False)
    return escaped.replace(UL_START, "<u>").replace(UL_END, "</u>").replace("\n", "<br>")


def cell_html(text: str, is_authored: bool) -> str:
    """A cell's markup, whether it was computed or typed.

    An override already holds real HTML, captured from the web version's editable cell, so
    it goes through untouched. Anything computed still needs marking up.
    """
    return str(text or "") if is_authored else engine_text_to_html(text)


# A forced line break starts a new bidi paragraph in CSS, and does not in Qt: a <br> becomes
# a line separator inside one paragraph, so the whole cell resolves as a single bidi run. The
# שחרית schedule showed what that costs. Its ר"ח heading is Hebrew, and the times on the line
# below it, being digits and punctuation, were pulled into that heading's right to left run
# and printed as "**7:35 ,7:15, *7:00 ,6:40". A direction mark at the head of each line gives
# those neutrals a strong character of the right direction to resolve against, and unlike
# splitting the markup into one element per line it cannot disturb a tag that spans a break.
LRM = "\u200e"
RLM = "\u200f"
_BR = re.compile(r"<br\s*/?>", re.IGNORECASE)


def _anchor_direction(html_text: str, rtl: bool) -> str:
    mark = RLM if rtl else LRM
    return mark + _BR.sub(lambda m: m.group(0) + mark, html_text)


# The everyday שחרית schedule is stored wrapped in class="big", which the stylesheet sets a
# third larger than the ר"ח block beneath it. A class selector in QTextDocument's default
# stylesheet did not reach it (measured: both blocks still came out at 10.1pt), so the rule
# is written onto the element instead, where it does apply.
_BIG_CLASS = re.compile(r'<span class="big"', re.IGNORECASE)


def _inline_big(html_text: str, point_size: float) -> str:
    """A percentage did not reach it either (measured: still 10.1pt against a 10pt base), so
    the size is worked out here and written in points, which QTextDocument does honour."""
    return _BIG_CLASS.sub(f'<span style="font-size:{point_size * 1.3:.2f}pt"', html_text)


def make_document(
    html_text: str,
    *,
    families: list,
    point_size: float,
    color: str,
    width: float,
    align=Qt.AlignHCenter,
    bold: bool = True,
    line_height: float | None = None,
    device=None,
    rtl: bool = False,
) -> QTextDocument:
    """A laid out fragment, ready to be drawn at a position.

    Direction is left to right even inside a right to left table, deliberately. Bare digits
    are directionally weak, so without this the bidi algorithm visually reverses a slash
    separated list and "9:03 / 9:15" comes out as "9:15 / 9:03". Hebrew words inside a cell
    still render correctly as embedded right to left runs.
    """
    doc = QTextDocument()
    doc.setDocumentMargin(0)
    # Without this the document lays itself out against the screen's DPI while the painter
    # draws at the printer's, so every point size comes out wrong by that ratio: at 300dpi
    # against a 96dpi screen, a 10pt column header printed at about 3pt.
    if device is not None:
        doc.documentLayout().setPaintDevice(device)
    font = QFont()
    font.setFamilies(families)
    font.setPointSizeF(point_size)
    font.setBold(bold)
    doc.setDefaultFont(font)

    option = QTextOption(align)
    option.setTextDirection(Qt.RightToLeft if rtl else Qt.LeftToRight)
    option.setWrapMode(QTextOption.WordWrap)
    doc.setDefaultTextOption(option)

    style = f"color:{color};"
    if line_height is not None:
        style += f"line-height:{line_height * 100:.0f}%;"
    direction = "rtl" if rtl else "ltr"
    html_text = _anchor_direction(_inline_big(html_text, point_size), rtl)
    doc.setDefaultStyleSheet(f"body,p,div,span{{{style}}} u{{text-decoration:underline}}")
    doc.setHtml(f'<body style="{style}"><div dir="{direction}" style="{style}">{html_text}</div></body>')
    doc.setTextWidth(width)
    return doc


def rtl_document(html_text: str, **kwargs) -> QTextDocument:
    """The same, for a run that really is right to left: a parsha name or a column header."""
    return make_document(html_text, rtl=True, **kwargs)


def color(value: str) -> QColor:
    return QColor(value)
