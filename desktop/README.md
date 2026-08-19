# The desktop program

A rebuild of this tool as a program that runs on its own: no browser, no local server,
nothing to install alongside it. The brief and the reasoning behind the technology choice
are in the build prompt; this file is about what is here now and how to run it.

**This is unfinished.** See "What is done" below before relying on any of it. The live
site is unaffected: nothing in this folder is served, and nothing in `js/` was changed.

## Running the tests

Three suites, all of which measure real output rather than checking that code ran:

```bash
python3 desktop/tests/test_golden.py          # the calculation engine
python3 desktop/tests/test_chart_layout.py    # the printed wall chart
python3 desktop/tests/test_card_layout.py     # the printed week card
```

`test_golden.py` checks the engine against `fixtures/golden.json`, which is the reference
output of the web version's own engine. It needs nothing beyond the standard library.

The two layout suites render real pages to PDF and measure them. They need `PySide6` and
`PyMuPDF`, and force Qt's offscreen platform so they run with no display.

```bash
pip install PySide6-Essentials PyMuPDF
```

## What is done

**The calculation engine**, ported module for module from `js/`, passing all 48,610 checks
in the golden fixture: the formatting helpers, Rosh Hashana and year type for AM 5700 to
5900, `dateFromHebrew` round trips, four years of the calendar day by day, all 21 named
zmanim for every day of 2026, 26 season-years of built rows for both charts with their
page splits and effective seasons, every seeded rule firing, and the named edge cases. The
worst raw difference against the JavaScript is 2.220e-16 of a day, one bit of a double.

**The printed chart**, both Shabbos charts and the Weekday chart, rendered with Qt and
verified page by page against the same page printed by the web version. 66 measured
checks: letter landscape at exactly 792 by 612 points, every body row the same height,
the header row never shorter, nothing outside the margins, and every time and parsha on
the page matching what the engine produced.

**The week cards**, שבת and חול, also verified against the same card printed by the web
version. 59 checks: the line splitting on its own as plain string transforms, then the
finished cards at letter portrait with every time present and nothing past the edges. The
rows are drawn line by line rather than as one laid out block, which is what makes the
colon axis exact: a line whose hour is one digit is started a digit's width further in.

## What is not done

- Every screen: Generate, This week, Saved sheets, Settings, Rules, the sheet editor with
  its per-cell overrides and rich text.
- Saving and loading, and importing a backup exported from the web version.
- Printing to a real printer. `render/output.py` has the path and it goes through the same
  painter as the PDF, but it has not been run against a printer from this machine.
- The single file executable. See below.

## Layout

```
zmanimboard/
  engine/          the calculation engine, a port of js/. No Qt, no interface.
    jsmath.py      the four places Python and JavaScript disagree about arithmetic
    fmt.py         time formatting, minute rounding, the underline sentinels
    solar.py       the solar position core, the workbook's calc* functions
    zmanim.py      the named zmanim
    hebrew_calendar.py
    sheets/        the column formulas for each chart, and the season week lists
    settings.py    the settings model and the shipped defaults
    tables.py      the Hebrew calendar lookup tables
  render/          drawing and printing. Qt lives here and nowhere else.
    theme.py       the page geometry and colour, taken from css/app.css
    fonts.py       the bundled Hebrew faces and the stand-in mapping
    richtext.py    engine strings and hand typed HTML into laid out text
    lines.py       how many times to a line, and the colon axis. No Qt.
    chart.py       one page of a wall chart
    card.py        one week card
    weekcards.py   which rows go on a card, and what each is called
    output.py      PDF and printer
  assets/fonts/    David Libre and Frank Ruhl Libre as TTF
tests/
```

The engine imports nothing from `render`, and nothing from Qt. That is deliberate: it is
the part that has to be provably identical to the web version, and it is testable without
a display or a graphics stack.

## The fonts

Qt cannot load the WOFF2 files the website ships, so `assets/fonts/` holds the same faces
converted to TTF. Same outlines, same files, SIL Open Font License 1.1; the licences are in
`assets/fonts/` at the repository root.

Frank Ruhl Libre needs one extra step. It ships as a variable font spanning weight 300 to
900, and Qt registers a variable font under its default instance only: the family came up
with a Regular style and no Bold, so every bold run on the page silently rendered regular.
Measured in the PDF, LiberationSerif and FrankRuhlLibre-Regular where the web version had
LiberationSerif-Bold. So two static instances are cut from it instead.

```bash
pip install fonttools brotli
python3 -c "
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from pathlib import Path
out = Path('desktop/zmanimboard/assets/fonts'); out.mkdir(parents=True, exist_ok=True)
for w in sorted(Path('assets/fonts').glob('david-libre-*.woff2')):
    f = TTFont(str(w)); f.flavor = None; f.save(str(out / (w.stem + '.ttf')))
for weight, style in ((400, 'Regular'), (700, 'Bold')):
    f = TTFont('assets/fonts/frank-ruhl-libre.woff2'); f.flavor = None
    instancer.instantiateVariableFont(f, {'wght': weight}, inplace=True, updateFontNames=True)
    f['OS/2'].usWeightClass = weight
    f['name'].setName('Frank Ruhl Libre', 1, 3, 1, 0x409)
    f['name'].setName(style, 2, 3, 1, 0x409)
    if style == 'Bold':
        f['head'].macStyle |= 1
        f['OS/2'].fsSelection = (f['OS/2'].fsSelection & ~0x40) | 0x20
    f.save(str(out / f'frank-ruhl-libre-{weight}.ttf'))
"
```

## Building the single file executable

Not done yet, and it cannot be done from Linux: PyInstaller does not cross compile. On a
Windows machine with Python installed:

```bash
pip install PySide6-Essentials PyInstaller
pyinstaller --onefile --windowed --name Zmanim ^
  --add-data "desktop/zmanimboard/assets;assets" ^
  --add-data "data;data" ^
  desktop/zmanimboard/app.py
```

`assets` and `data` have to travel inside the bundle: `engine/tables.py` and
`render/fonts.py` both look in `sys._MEIPASS` first for exactly this reason. `app.py` does
not exist yet.

## The rule that matters

The engine is a port, not a rewrite. If a number here disagrees with `fixtures/golden.json`
it is wrong, whatever it looks like on paper, and the fixture is not the thing to change.
