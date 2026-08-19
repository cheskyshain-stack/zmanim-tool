"""Proof that the built program actually starts.

Run with `--selftest`, which the build workflow does straight after packaging. It answers the
one question the ordinary test suites cannot: the suites run against the source tree, where
the fonts and the Hebrew calendar tables are simply files on disk, but the built program has
to find them inside itself. A packaging mistake leaves every suite green and hands over a
program that opens to a blank chart, or does not open at all.

So this goes through the whole thing once in a throwaway folder: every screen, a season
generated (which needs the tables), a page drawn (which needs the fonts), and a PDF written.
It prints what it found and returns non-zero if any of it is missing.
"""
import os
import sys
import tempfile
from pathlib import Path


def run_selftest() -> int:
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    from PySide6.QtWidgets import QApplication

    app = QApplication.instance() or QApplication([])
    app.setApplicationName("ZmanimBoard")

    from . import sheets as sheetlib
    from .app import Window, beside_the_program, data_dir
    from .render.fonts import load_bundled
    from .render.output import write_chart_pdf

    problems = []

    def check(name: str, ok: bool, detail: str = ""):
        print(f"  {'ok  ' if ok else 'FAIL'} {name}{('  ' + detail) if detail else ''}")
        if not ok:
            problems.append(name)

    print(f"\nfrozen: {getattr(sys, 'frozen', False)}   running from: {sys.executable}")
    print(f"save folder would be: {data_dir()}")
    print(f"beside the program:   {beside_the_program(Path(sys.executable))}\n")

    # The fonts have to have travelled inside the program. Without them Qt falls back to
    # something with no Hebrew and the board comes out in the wrong face, which is the kind of
    # thing that is only noticed once it is on the wall.
    families = load_bundled()
    check("the Hebrew fonts are inside the program", len(families) >= 2, ", ".join(sorted(set(families))))

    # Only means anything on a Mac, where the program is a folder and the naive answer puts a
    # person's boards inside the application, to be thrown away with it.
    if getattr(sys, "frozen", False):
        beside = str(beside_the_program(Path(sys.executable)))
        check("the save folder is not inside the program itself", ".app/Contents/" not in beside, beside)

    with tempfile.TemporaryDirectory() as tmp:
        window = Window(Path(tmp))
        window.resize(1200, 860)
        window.show()
        app.processEvents()

        names = []
        for row in range(window.nav.count()):
            window.nav.setCurrentRow(row)
            app.processEvents()
            names.append(window.nav.item(row).text())
        check("every screen opens", len(names) == 5, ", ".join(names))

        # Generating needs the Hebrew calendar tables, which are the other thing that has to
        # travel inside the program.
        generate = window.screens["generate"]
        generate.choref.setChecked(True)
        generate.year.setValue(5787)
        generate.refresh()
        generate.generate()
        app.processEvents()
        sheets = window.state["sheets"]
        check("the calendar tables are inside the program", len(sheets) == 2,
              f"{len(sheets)} sheets from one season")

        screen = window.sheet_screen
        pages = screen.pages()
        check("a season comes out as three pages", len(pages) == 3, f"{len(pages)} pages")
        check("with weeks on them", all(page.weeks for page in pages),
              ", ".join(str(len(page.weeks)) for page in pages))

        # Drawing is where a missing font or a missing table actually shows, so the page is
        # really painted rather than merely built.
        drawn = screen.pages_layout.itemAtPosition(0, 0)
        widget = drawn.widget() if drawn else None
        check("the first page is drawn on the screen", widget is not None and widget.pixmap().width() > 200,
              f"{widget.pixmap().width()}px wide" if widget else "nothing drawn")
        check("and its cells can be clicked", bool(widget and widget.cells),
              f"{len(widget.cells) if widget else 0} cells")

        out = Path(tmp) / "selftest.pdf"
        write_chart_pdf(str(out), pages, sheetlib.style_of(sheets[0]),
                        sheetlib.chrome_of(window.state["settings"]))
        size = out.stat().st_size if out.exists() else 0
        check("a PDF is written", size > 20000, f"{size} bytes")

        # The save file is the thing a person's work lives in, so it has to have been written
        # by now rather than at some later moment nobody controls.
        saved = Path(tmp) / "zmanim-state.json"
        check("the save file is written", saved.exists() and saved.stat().st_size > 100,
              f"{saved.stat().st_size} bytes" if saved.exists() else "no file")

    print()
    if problems:
        print(f"  {len(problems)} of the checks failed: {', '.join(problems)}")
        return 1
    print("  The built program starts, draws a board and writes a PDF.")
    return 0
