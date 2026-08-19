# The desktop program

A rebuild of this tool as a program that runs on its own: no browser, no local server,
nothing to install alongside it. The brief and the reasoning behind the technology choice
are in the build prompt; this file is about what is here now and how to run it.

**This is unfinished.** See "What is done" below before relying on any of it. The live
site is unaffected: nothing in this folder is served, and nothing in `js/` was changed.

## Running the tests

Eight suites, all of which measure real output rather than checking that code ran:

```bash
python3 desktop/tests/test_golden.py          # the calculation engine
python3 desktop/tests/test_chart_layout.py    # the printed wall chart
python3 desktop/tests/test_card_layout.py     # the printed week card
python3 desktop/tests/test_state.py           # what is saved, and what generating makes
python3 desktop/tests/test_week.py            # which week This week opens on, and its cards
python3 desktop/tests/test_settings.py        # settings, rules, and importing a backup
python3 desktop/tests/test_editor.py          # typing over a cell, and the style controls
python3 desktop/tests/test_publish.py         # what gets published, against a stubbed GitHub
```

And to run the program itself:

```bash
python3 desktop/run.py
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

**The program**: a window with a sidebar, and four places behind it. **Generate** makes a
season. **This week** shows the week's two cards as they print, opening on whichever שבת is
next and moving on by itself once Shabbos is over, with Previous, Today and Next, a choice
of which page comes first, "Print both on one sheet" (landscape, side by side, which has to
be the program's job because the page size is fixed here and the dialog's own landscape
setting would change nothing) and "Print every week to the end of the season". **Saved
sheets** lists what has been made. **Settings** holds the wording on the boards, where the
shul is, the advanced zmanim settings, the rules, and Export and Import backup. And a
**sheet view** previews every page at the size it prints, with Print and Save as PDF.

**Publishing** puts a season on lczmanim.cjaffa.com. The congregation's page is a static
site, so publishing means committing one file to the repository behind it,
`data/published.json`, through GitHub's own API: one HTTPS call, no backend, and nothing
installed beyond this program. Publishing a season leaves every other published season
standing, and publishing the same season again replaces it, which is how a correction
reaches the congregation. The file written is the same shape as the one the website writes,
checked against the real one, so the two programs can publish to the same site.

The token lives in its own file beside the save file and is deliberately kept out of a
backup: a backup gets shared, and a write token must not.

**Cells are typed over by clicking them.** The map of where each cell was drawn comes from
the same painting run as the picture, so a click lands on the cell that is really under it
rather than on one worked out a second time. The dialog shows what the cell works out to
and takes what should print instead, with Ctrl+U for the underline the board uses to mark an
alternate time, and undo and redo above. Typing a cell back to exactly what it works out to
clears the override rather than storing one that agrees: stored, it would do nothing today
and quietly stop following a corrected formula tomorrow. Font, size, logo size and page
colour are on the same bar, kept per sheet, and the last one set becomes the starting point
for the next sheet generated.

**Rules** are edited from Settings, laid out as a sentence: when this happens, do this to
these columns. A rule applies to every sheet generated from then on, every year; typing over
a cell on a sheet is the other thing, a one-off belonging to that sheet alone, and the
Settings screen says so where the rules are. Saving is
a single JSON file in the same format the web version exports, so a backup from there opens
here: checked against `data/published.json`, hand typed cell overrides included.

Rules and overrides are applied when a sheet is opened rather than stored: a sheet keeps
only which weeks it covers and how they split, so a fix to a formula reaches every sheet
already made.

## What is not done

- The page picker, side by side, and fit to screen from the web version's sheet view.
- The guide.
- Printing to a real printer. `render/output.py` has the path and it goes through the same
  painter as the PDF, but it has not been run against a printer from this machine.
- The single file executable. See below.

## Layout

```
zmanimboard/
  app.py           the window and its screens
  state.py         the save file, in the web version's own format
  sheets.py        making a sheet, and turning a saved one back into printable pages
  weeks.py         which weeks there are, and which one is "this" one
  htmlfield.py     a rich text box that saves the same small markup subset the site stores
  rulesui.py       the rule editor
  celldialog.py    typing over one cell
  publish.py       committing a season to the congregation's site
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

## Getting the Windows program

PyInstaller does not cross compile, so an .exe cannot be built on Linux. GitHub's own
Windows machines can, and that is what `.github/workflows/desktop-windows.yml` is for. No
Windows machine of your own is needed.

1. Open the repository's **Actions** tab.
2. Pick **Build the Windows program** and press **Run workflow**.
3. Wait a few minutes, open the finished run, and download **Zmanim-windows** from the
   Artifacts at the bottom. Inside is `Zmanim.exe`.

It only ever runs when it is started by hand, never on a push: a build takes a few minutes
and is only wanted when there is a version to hand to someone.

The workflow runs all eight test suites on Windows first. If the numbers disagree with
`fixtures/golden.json` there is nothing worth building.

To build it on a Windows machine instead:

```
pip install PySide6-Essentials PyInstaller
pyinstaller --onefile --windowed --name Zmanim --paths desktop ^
  --add-data "desktop/zmanimboard/assets;assets" ^
  --add-data "data;data" ^
  desktop/run.py
```

`assets` and `data` have to travel inside the bundle: `engine/tables.py` and
`render/fonts.py` both look in `sys._MEIPASS` first for exactly this reason.

A built program keeps its save file beside the executable when that folder can be written
to, which is what lets a copy on a USB stick carry its own data, and otherwise in the usual
per-user application data folder. See `data_dir` in `app.py`.

## The rule that matters

The engine is a port, not a rewrite. If a number here disagrees with `fixtures/golden.json`
it is wrong, whatever it looks like on paper, and the fixture is not the thing to change.
