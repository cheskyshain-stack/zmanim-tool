"""Colour and the stylesheet that comes out of it.

The whole interface is styled from one palette object, and the stylesheet is
generated rather than hand written, so light and dark cannot drift apart. That
is the same failure this avoids as a token based web palette: a colour whose
only definition lives in one theme.

The accent is a deep pine green rather than the usual desktop blue. It is doing
work as well as decoration: it is the colour of the offline indicator, so the
one thing the eye is drawn to is the state that matters most here.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Palette:
    name: str
    paper: str          # window background
    surface: str        # cards, panels
    sunk: str           # inputs, table headers, the nav rail
    ink: str            # primary text
    ink_2: str          # secondary text
    ink_3: str          # captions, disabled
    rule: str           # borders
    rule_soft: str      # inner separators
    accent: str
    accent_hover: str
    accent_soft: str    # accent background wash
    on_accent: str
    warn: str
    warn_soft: str
    danger: str
    danger_soft: str


LIGHT = Palette(
    name="light",
    paper="#F7F5F1",
    surface="#FFFFFF",
    sunk="#EFECE6",
    ink="#15191C",
    ink_2="#3D464B",
    ink_3="#727B77",
    rule="#DCD6CC",
    rule_soft="#EAE5DC",
    accent="#1D6B57",
    accent_hover="#175747",
    accent_soft="#E2EDE8",
    on_accent="#FFFFFF",
    warn="#8A6210",
    warn_soft="#F5EDDB",
    danger="#9C3838",
    danger_soft="#F6E5E3",
)

DARK = Palette(
    name="dark",
    paper="#131618",
    surface="#1B1F21",
    sunk="#0F1213",
    ink="#EDEBE5",
    ink_2="#BFC4C0",
    ink_3="#8B948F",
    rule="#2E3436",
    rule_soft="#242A2B",
    accent="#4FBF9E",
    accent_hover="#63D0AF",
    accent_soft="#16302A",
    on_accent="#0B1512",
    warn="#D9AA53",
    warn_soft="#2F2616",
    danger="#E08078",
    danger_soft="#33201E",
)


def for_theme(theme: str, system_is_dark: bool = False) -> Palette:
    if theme == "dark":
        return DARK
    if theme == "light":
        return LIGHT
    return DARK if system_is_dark else LIGHT


def stylesheet(p: Palette) -> str:
    """Build the application stylesheet from a palette.

    Qt style sheets are a small subset of CSS: no variables, no flexbox, and
    padding on some widgets behaves differently from the web. Layout is done in
    code and this file handles colour, borders and type only.
    """
    return f"""
* {{
    font-family: "Segoe UI", "Segoe UI Variable", system-ui, sans-serif;
    font-size: 14px;
    color: {p.ink};
}}

QWidget#Root, QMainWindow {{ background: {p.paper}; }}

/* ---- navigation rail ---- */
QWidget#NavRail {{
    background: {p.sunk};
    border-right: 1px solid {p.rule};
}}
QLabel#WordMark {{
    font-size: 19px;
    font-weight: 700;
    color: {p.ink};
    padding: 2px 4px;
}}
QLabel#WordMarkSub {{
    font-size: 11px;
    color: {p.ink_3};
    padding: 0 4px 2px 4px;
}}
QPushButton#NavItem {{
    text-align: left;
    padding: 9px 12px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: {p.ink_2};
    font-size: 14px;
}}
QPushButton#NavItem:hover {{ background: {p.rule_soft}; color: {p.ink}; }}
QPushButton#NavItem:checked {{
    background: {p.accent_soft};
    color: {p.accent};
    font-weight: 600;
}}

/* ---- header ---- */
QLabel#PageTitle {{ font-size: 24px; font-weight: 600; color: {p.ink}; }}
QLabel#PageBlurb {{ font-size: 14px; color: {p.ink_2}; }}
QLabel#SectionLabel {{
    font-size: 11px;
    font-weight: 600;
    color: {p.ink_3};
    letter-spacing: 1px;
}}

/* ---- status pill ---- */
QLabel#StatusPill {{
    padding: 5px 12px;
    border-radius: 11px;
    font-size: 12px;
    font-weight: 600;
    background: {p.accent_soft};
    color: {p.accent};
    border: 1px solid {p.accent};
}}
QLabel#StatusPill[state="warn"] {{
    background: {p.warn_soft};
    color: {p.warn};
    border-color: {p.warn};
}}
QLabel#StatusPill[state="danger"] {{
    background: {p.danger_soft};
    color: {p.danger};
    border-color: {p.danger};
}}

/* ---- cards ---- */
QFrame#Card {{
    background: {p.surface};
    border: 1px solid {p.rule};
    border-radius: 8px;
}}
QFrame#ActionCard {{
    background: {p.surface};
    border: 1px solid {p.rule};
    border-radius: 10px;
}}
QFrame#ActionCard:hover {{ border-color: {p.accent}; background: {p.accent_soft}; }}
QLabel#ActionGlyph {{ font-size: 30px; }}
QLabel#ActionTitle {{ font-size: 16px; font-weight: 600; color: {p.ink}; }}
QLabel#ActionBlurb {{ font-size: 13px; color: {p.ink_2}; }}

QFrame#DropZone {{
    background: {p.sunk};
    border: 2px dashed {p.rule};
    border-radius: 10px;
}}
QFrame#DropZone[hot="true"] {{ border-color: {p.accent}; background: {p.accent_soft}; }}

/* ---- controls ---- */
QPushButton {{
    background: {p.surface};
    border: 1px solid {p.rule};
    border-radius: 6px;
    padding: 7px 15px;
    color: {p.ink};
}}
QPushButton:hover {{ border-color: {p.ink_3}; }}
QPushButton:disabled {{ color: {p.ink_3}; background: {p.sunk}; }}
QPushButton#Primary {{
    background: {p.accent};
    color: {p.on_accent};
    border: 1px solid {p.accent};
    font-weight: 600;
}}
QPushButton#Primary:hover {{ background: {p.accent_hover}; border-color: {p.accent_hover}; }}
QPushButton#Primary:disabled {{ background: {p.sunk}; border-color: {p.rule}; color: {p.ink_3}; }}
QPushButton#Danger {{ color: {p.danger}; border-color: {p.danger}; }}
QPushButton#Link {{
    background: transparent; border: none; color: {p.accent};
    padding: 2px 4px; text-align: left;
}}

QComboBox, QLineEdit, QSpinBox, QDoubleSpinBox {{
    background: {p.surface};
    border: 1px solid {p.rule};
    border-radius: 6px;
    padding: 6px 9px;
    selection-background-color: {p.accent};
    selection-color: {p.on_accent};
}}
QComboBox:focus, QLineEdit:focus, QSpinBox:focus, QDoubleSpinBox:focus {{
    border-color: {p.accent};
}}
QComboBox::drop-down {{ border: none; width: 20px; }}
QComboBox QAbstractItemView {{
    background: {p.surface};
    border: 1px solid {p.rule};
    selection-background-color: {p.accent_soft};
    selection-color: {p.ink};
    outline: none;
}}

QCheckBox {{ spacing: 8px; color: {p.ink}; }}
QCheckBox::indicator {{
    width: 16px; height: 16px;
    border: 1px solid {p.rule};
    border-radius: 4px;
    background: {p.surface};
}}
QCheckBox::indicator:checked {{ background: {p.accent}; border-color: {p.accent}; }}

QProgressBar {{
    background: {p.sunk};
    border: none;
    border-radius: 4px;
    height: 8px;
    text-align: center;
    color: {p.ink_2};
}}
QProgressBar::chunk {{ background: {p.accent}; border-radius: 4px; }}

QTextEdit, QPlainTextEdit, QListWidget, QTableWidget, QTreeWidget {{
    background: {p.surface};
    border: 1px solid {p.rule};
    border-radius: 8px;
    selection-background-color: {p.accent_soft};
    selection-color: {p.ink};
}}
QHeaderView::section {{
    background: {p.sunk};
    color: {p.ink_3};
    border: none;
    border-bottom: 1px solid {p.rule};
    padding: 7px 10px;
    font-size: 11px;
    font-weight: 600;
}}
QTableWidget {{ gridline-color: {p.rule_soft}; }}

QScrollArea {{ background: transparent; border: none; }}
QScrollBar:vertical {{ background: transparent; width: 11px; margin: 0; }}
QScrollBar::handle:vertical {{
    background: {p.rule}; border-radius: 5px; min-height: 30px;
}}
QScrollBar::handle:vertical:hover {{ background: {p.ink_3}; }}
QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; width: 0; }}
QScrollBar::add-page, QScrollBar::sub-page {{ background: transparent; }}

QFrame#Divider {{ background: {p.rule}; max-height: 1px; border: none; }}

QLabel#Caption {{ font-size: 12px; color: {p.ink_3}; }}
QLabel#Mono {{ font-family: "Consolas", "Cascadia Mono", monospace; font-size: 12px; }}
QLabel#Hebrew {{ font-size: 16px; }}

QToolTip {{
    background: {p.surface};
    color: {p.ink};
    border: 1px solid {p.rule};
    padding: 5px 8px;
}}
"""
