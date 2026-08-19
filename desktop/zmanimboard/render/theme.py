"""The printed page's geometry and colour, taken from css/app.css and css/print.css.

Everything is in inches, because the page is a physical thing: a letter sheet is 11 by 8.5
and every measurement on it was chosen against that, not against a pixel count. The web
version expresses the same numbers in inches and points for the same reason.

Numbers here are load bearing. A visual regression on paper is a real cost, not a cosmetic
one, so anything changed here needs a printed page measured against the old one.
"""
from dataclasses import dataclass

PT = 1 / 72  # a point, in inches
PX = 1 / 96  # a CSS pixel, in inches: what a 1px border in the stylesheet means


@dataclass(frozen=True)
class ChartGeometry:
    """The wall chart: letter landscape."""
    width: float = 11.0
    height: float = 8.5
    pad_top: float = 0.35
    pad_side: float = 0.5
    # .page-header margin-bottom
    header_gap: float = 0.1
    # .header-icon and .header-logo heights, before the sheet's own headerScale
    icon_height: float = 0.85
    logo_height: float = 0.62
    header_inner_gap: float = 0.15
    # .page-footer margin-top, and the gap between the rules and the text
    footer_gap: float = 0.08
    footer_rule_gap: float = 0.12
    # th, td padding
    cell_pad_y: float = 0.035
    cell_pad_x: float = 0.05
    border: float = PX
    # table:not(.weekday-table) .parsha-cell min-width, in em of the sheet's font size
    parsha_min_width_em: float = 5.5
    # .weekday-table col[data-colkey="parsha"] width
    weekday_parsha_fraction: float = 0.14


@dataclass(frozen=True)
class CardGeometry:
    """The week card: letter portrait."""
    width: float = 8.5
    height: float = 11.0
    pad_top: float = 0.55
    pad_side: float = 0.6
    pad_bottom: float = 0.5
    header_scale: float = 0.77
    title_gap: float = 0.24
    lines_gap: float = 0.22
    line_pad_y: float = 0.1
    line_pad_x: float = 0.16
    line_gap: float = 0.07
    measure: float = 5.6  # .week-lines-inner max-width
    legend_gap: float = 0.12
    foot_gap: float = 0.15


CHART = ChartGeometry()
CARD = CardGeometry()

# Grid lines on the printed chart, and the ink everything is set in.
GRID_COLOR = "#9aa7b3"
INK = "#1a1a1a"
FOOTER_INK = "#444444"
PAPER = "#ffffff"

# Point sizes on the week card, which are fixed rather than following the chart's slider.
CARD_TITLE_PT = 20
CARD_LABEL_PT = 13
CARD_TIME_PT = 14
CARD_LEGEND_PT = 9.5
CARD_FOOT_PT = 10.5
CARD_BASE_PT = 11


def band_color(accent: str) -> str:
    """The alternating row band: the header colour mixed 40% with white.

    It was 5%, which read fine under the old dark gray header and all but vanished once the
    header went light, 5% of a light gray being white. At 40% the band is plainly a band
    under either.
    """
    return mix(accent, "#ffffff", 0.4)


def mix(a: str, b: str, ratio: float) -> str:
    """CSS color-mix(in srgb, a <ratio>, b)."""
    ar, ag, ab = _rgb(a)
    br, bg, bb = _rgb(b)
    out = [round(x * ratio + y * (1 - ratio)) for x, y in ((ar, br), (ag, bg), (ab, bb))]
    return "#%02x%02x%02x" % tuple(out)


def header_ink(accent: str) -> str:
    """Black or white, whichever the header row can actually be read in against the page
    colour. White on the dark grey the chart shipped with, black once the colour is light:
    without this, a light page colour left the header white on near-white and the column
    names simply vanished. Rec. 601 luma, with the threshold at the middle of the range.
    """
    try:
        r, g, b = _rgb(accent)
    except ValueError:
        return "#ffffff"
    return INK if 0.299 * r + 0.587 * g + 0.114 * b > 140 else "#ffffff"


def _rgb(color: str):
    hexpart = color.lstrip("#")
    if len(hexpart) != 6:
        raise ValueError(f"not a six digit hex colour: {color!r}")
    return tuple(int(hexpart[i:i + 2], 16) for i in (0, 2, 4))
