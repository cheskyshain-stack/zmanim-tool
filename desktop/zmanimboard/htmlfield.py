"""A small rich text box that saves the markup the rest of the program already understands.

The שחרית schedules and the footer notes are edited with underlining, because the printed
board underlines the alternate times, and they are stored as markup. QTextEdit's own
toHtml() is a whole styled document, hundreds of characters of head and inline style for
one line of times, which would then be what the chart renders and what a backup carries to
the web version. So the document is walked and written out as the same small subset the web
version stores: <u>, <br>, and nothing else.
"""
import html
import re

from PySide6.QtGui import QKeySequence, QShortcut, QTextCharFormat, QTextCursor, QFont
from PySide6.QtWidgets import QTextEdit

# The everyday שחרית schedule is stored wrapped in this, which the wall chart sets a third
# larger than the ר"ח block under it. The wrapper is not something to edit, so it is taken
# off on the way into the box and put back on the way out, and the user edits the times.
BIG_OPEN = '<span class="big">'
BIG_CLOSE = "</span>"


def unwrap_big(value: str):
    text = str(value or "")
    if text.startswith(BIG_OPEN) and text.endswith(BIG_CLOSE):
        return text[len(BIG_OPEN):-len(BIG_CLOSE)], True
    return text, False


def wrap_big(value: str, was_big: bool) -> str:
    return f"{BIG_OPEN}{value}{BIG_CLOSE}" if was_big else value


def to_subset(document) -> str:
    """The document as <u> and <br>, and nothing else."""
    lines = []
    block = document.begin()
    while block.isValid():
        parts = []
        iterator = block.begin()
        while not iterator.atEnd():
            fragment = iterator.fragment()
            if fragment.isValid():
                # A <br> inside a block becomes U+2028 in the document, not a new block, so
                # it has to be turned back into a break here or the stored value keeps a
                # character nothing downstream knows about.
                text = html.escape(fragment.text().replace("\u2028", "\n").replace("\u2029", "\n"), quote=False)
                text = text.replace("\n", "<br>")
                if text:
                    parts.append(f"<u>{text}</u>" if fragment.charFormat().fontUnderline() else text)
            iterator += 1
        lines.append("".join(parts))
        block = block.next()
    # Adjacent underlines from separate fragments read as one, so they are joined up rather
    # than left as "<u>7</u><u>:35</u>", which is the same on the page and noise in a backup.
    return re.sub(r"</u>\s*<u>", "", "<br>".join(lines)).strip()


def from_subset(value: str) -> str:
    """The stored markup as something QTextEdit will show. It understands this subset
    directly; the newline form is accepted too, because that is how the very first version
    of these fields was stored."""
    return str(value or "").replace("\n", "<br>")


class HtmlField(QTextEdit):
    """One of those boxes. Ctrl+U underlines the selection, the same key the web version
    uses, and the toolbar button beside it does the same thing."""

    def __init__(self, value: str = "", height: int = 90):
        super().__init__()
        self.was_big = False
        self.set_value(value)
        self.setFixedHeight(height)
        self.setAcceptRichText(False)  # a paste brings its own styling in otherwise
        shortcut = QShortcut(QKeySequence("Ctrl+U"), self)
        shortcut.activated.connect(self.toggle_underline)

    def set_value(self, value: str):
        inner, self.was_big = unwrap_big(value)
        self.setHtml(from_subset(inner))

    def value(self) -> str:
        return wrap_big(to_subset(self.document()), self.was_big)

    def toggle_underline(self):
        cursor = self.textCursor()
        fmt = QTextCharFormat()
        fmt.setFontUnderline(not cursor.charFormat().fontUnderline())
        if cursor.hasSelection():
            cursor.mergeCharFormat(fmt)
        else:
            self.mergeCurrentCharFormat(fmt)
