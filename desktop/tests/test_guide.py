"""The guide, and whether it is still telling the truth.

A guide is prose, so most of it cannot be checked by a machine. One thing can: every control
it names by its label has to be a control that exists. That is what goes stale first, and
a guide that sends someone looking for a button that was renamed is worse than no guide.

So the buttons the guide names are listed here, checked to be in the guide's words, and
checked against the labels really on the screens.

    python3 desktop/tests/test_guide.py
"""
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "desktop"))

# A Windows console writes cp1252, and every test name here is in Hebrew. Without this, a run
# where every single check passed still ends non-zero, on the print at the end rather than on
# anything it measured. errors="replace" is for the underline sentinels, U+E000 and U+E001,
# which are private use characters with no glyph in any font.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from PySide6.QtWidgets import QApplication, QCheckBox, QGroupBox, QPushButton  # noqa: E402

_app = QApplication.instance() or QApplication([])

from zmanimboard.app import Window  # noqa: E402
from zmanimboard.guide import SECTIONS  # noqa: E402


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

# Every control the guide names by its label. A button whose wording changes has to be
# changed in the guide too, and this is what says so.
NAMED = [
    "Generate",
    "Also make the Weekday chart for these weeks",
    "Undo",
    "Redo",
    "Page colour",
    "Fit to screen",
    "Side by side",
    "Save as PDF",
    "All",
    "Previous",
    "Today",
    "Next",
    "Print both on one sheet",
    "Print every week to the end of the season",
    "Publishing",
    "Publish",
    "Take it down",
    "What is live now",
    "Backup",
    "Export backup",
    "Import backup",
]

# Run together on one line: the guide is wrapped source, so a name like "What is live now"
# has a line break and an indent in the middle of it and would not be found as written.
GUIDE_TEXT = " ".join(" ".join((title + " " + body).split()) for title, body, _open in SECTIONS)

with tempfile.TemporaryDirectory() as tmp:
    window = Window(Path(tmp))
    window.resize(1200, 860)
    window.show()
    _app.processEvents()

    # --- the guide is a place you can get to -------------------------------------------------
    R.equal("the sidebar ends with the Guide",
            ["Generate", "This week", "Saved sheets", "Settings", "Guide"],
            [window.nav.item(i).text() for i in range(window.nav.count())])

    window.show_screen("guide")
    guide = window.screens["guide"]
    R.expect("and it opens", window.stack.currentWidget() is guide, "")
    R.equal("with the sidebar following it", 4, window.nav.currentRow())

    # --- the sections ---------------------------------------------------------------------------
    R.equal("eight sections", 8, len(guide.sections))
    open_now = [s.head.text() for s in guide.sections if s.body.isVisible()]
    R.equal("one open to start with, the one that gets you a board",
            ["Make your first board in three steps"], open_now)

    section = guide.sections[2]
    section.head.setChecked(True)
    _app.processEvents()
    R.expect("opening one shows what is under it", section.body.isVisible(), "")
    section.head.setChecked(False)
    _app.processEvents()
    R.expect("and closing it hides it again", not section.body.isVisible(), "")

    R.expect("every section says something", all(len(s.body.text()) > 200 for s in guide.sections),
             str([len(s.body.text()) for s in guide.sections]))

    start = next(b for b in guide.findChildren(QPushButton) if "Make a board" in b.text())
    start.click()
    _app.processEvents()
    R.expect("and the way out of it is into Generate",
             window.stack.currentWidget() is window.screens["generate"], "")

    # --- what the guide names has to exist ------------------------------------------------------
    # Every screen is built, and a sheet is generated, because some of the labels only appear
    # once there is something to publish or a page to leave out of a print.
    generate = window.screens["generate"]
    generate.choref.setChecked(True)
    generate.year.setValue(5787)
    generate.refresh()
    generate.generate()
    _app.processEvents()
    window.show_screen("settings")
    window.screens["settings"].refresh()
    window.show_screen("saved")
    window.show_screen("week")
    _app.processEvents()

    labels = set()
    for screen in list(window.screens.values()) + [window.sheet_screen]:
        for kind in (QPushButton, QCheckBox, QGroupBox):
            labels.update(widget.title() if kind is QGroupBox else widget.text()
                          for widget in screen.findChildren(kind))
    labels = {text.replace("&", "") for text in labels if text}

    missing_on_screen = [name for name in NAMED if not any(name in text for text in labels)]
    R.equal("every control the guide names is really there", [], missing_on_screen)

    missing_in_guide = [name for name in NAMED if name not in GUIDE_TEXT]
    R.equal("and the guide really names each of them", [], missing_in_guide)

    # --- the things a guide must not say --------------------------------------------------------
    # This program has no browser and nothing is kept in one, so wording carried over from the
    # website would be wrong here rather than merely untidy.
    for wrong in ("browser", "localStorage", "this site", "USB stick and open"):
        R.expect(f"the guide does not talk about {wrong!r}", wrong.lower() not in GUIDE_TEXT.lower(), "")

    # The house rule for this project, and prose is the easiest place to break it. Written as
    # an escape so this file does not itself contain the character it is banning.
    R.expect("and holds no em dashes", "\u2014" not in GUIDE_TEXT, "")

    # --- it survives an import ------------------------------------------------------------------
    # Importing a backup throws every screen away and builds them again. The guide is one of
    # them, and a screen that came back broken would only be found by opening it.
    window.rebuild()
    _app.processEvents()
    window.show_screen("guide")
    R.expect("the guide is still there after everything is rebuilt",
             window.stack.currentWidget() is window.screens["guide"], "")
    R.equal("with its sections", 8, len(window.screens["guide"].sections))

sys.exit(0 if R.summary() else 1)
