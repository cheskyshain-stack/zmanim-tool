"""The "what is this and how do I use it" screen.

Written for someone opening the program for the first time with no idea what it does, and
kept inside the program rather than in a file beside it: the whole point of this thing is
that it is one file that needs nothing else, and a guide in a separate document is the
first thing to be lost off a USB stick.

It describes this program, not the website. They do the same job and their wording is close,
but the differences are exactly where a guide copied across would start lying: there is no
browser print dialog here, no browser storage, and publishing is on the Settings screen
rather than on This week.
"""
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QFrame, QLabel, QPushButton, QScrollArea, QVBoxLayout, QWidget


class Section(QWidget):
    """A heading that opens and closes what is under it.

    Closed by default, so the screen reads as a list of questions rather than a wall of
    text, and the answer is one click away.
    """

    def __init__(self, title: str, body: str, open_now: bool = False):
        super().__init__()
        column = QVBoxLayout(self)
        column.setContentsMargins(0, 0, 0, 0)
        column.setSpacing(0)

        self.head = QPushButton(title)
        self.head.setCheckable(True)
        self.head.setChecked(open_now)
        self.head.setCursor(Qt.PointingHandCursor)
        self.head.setStyleSheet(
            "QPushButton { text-align: left; padding: 10px 12px; font-weight: 600; font-size: 14px;"
            " border: 1px solid #d6dae1; border-radius: 6px; background: #f6f7f9; }"
            "QPushButton:checked { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }"
        )
        column.addWidget(self.head)

        self.body = QLabel(body)
        self.body.setWordWrap(True)
        self.body.setTextFormat(Qt.RichText)
        self.body.setAlignment(Qt.AlignTop)
        self.body.setStyleSheet(
            "QLabel { padding: 12px 14px; border: 1px solid #d6dae1; border-top: 0;"
            " border-bottom-left-radius: 6px; border-bottom-right-radius: 6px; background: #ffffff; }"
        )
        self.body.setVisible(open_now)
        column.addWidget(self.body)

        self.head.toggled.connect(self.body.setVisible)


# Each entry is (title, body, open at the start). Kept as data rather than as a run of
# widget code so the words can be read and corrected without picking through layout calls.
SECTIONS = [
    (
        "Make your first board in three steps",
        """
        <p><b>1. Generate.</b> Pick the season and the year. שבת קיץ runs Pesach to Sukkos,
        שבת חורף runs Sukkos to Pesach. It starts on whichever season is coming next, so
        usually there is nothing to change. Which Shabbosim belong to the season is worked
        out here, and the ones with no parsha are left out.</p>
        <p><b>2. Choose how the weeks split across pages.</b> It says how many weeks the
        season has and suggests an even split. Change the number on any page and the rest
        move to match. Leave "Also make the Weekday chart for these weeks" ticked and one is
        made alongside, covering the same weeks.</p>
        <p><b>3. Press Generate.</b> The finished board opens straight away and is already
        saved. There is no save button to forget.</p>
        """,
        True,
    ),
    (
        "Working on a board",
        """
        <p><b>Any cell can be typed over.</b> Click it. The dialog shows what the cell works
        out to and takes what should print instead. <b>Ctrl+U</b> underlines the selection,
        which is how the board marks a time as the alternate one.</p>
        <p>Typing a cell back to exactly what it works out to clears it rather than storing
        an override that agrees: stored, it would do nothing today and quietly stop following
        a corrected formula tomorrow.</p>
        <p><b>Undo</b> and <b>Redo</b> cover typed cells for as long as the program stays
        open. They are not part of what is saved, the same as undo in most editors.</p>
        <p><b>Font, Size, Logo and Page colour</b> apply to the whole board. They are kept
        with that board, and the last one set becomes the starting point for the next board
        generated.</p>
        <p><b>Fit to screen</b> scales the pages down until a whole page is across the
        window, and turns itself on when one does not fit. <b>Side by side</b> puts the other
        chart's matching page next to each one, so the two can be checked row against row.
        The page beside cannot be typed in: it belongs to the other board, and the button in
        the bar opens it.</p>
        """,
        False,
    ),
    (
        "Printing, and saving a PDF",
        """
        <p><b>Print</b> opens the printer dialog. <b>Save as PDF</b> writes the file
        directly, without going through a printer at all.</p>
        <p>The paper is set here, not in the dialog: letter, landscape, and the shaded header
        row is part of what is drawn rather than a background the printer might drop.</p>
        <p><b>The tick boxes above the pages</b> choose what goes in. Everything is ticked to
        start with; untick a page to leave it out of the next print or PDF, and <b>All</b>
        puts them all back. A page left out stays on the screen, dimmed, so it can still be
        read. That is usually how a reprint goes: one page was wrong, or one page ran out on
        the wall.</p>
        <p>Sending a board to someone else means sending a PDF. They can open and print it
        with none of this: no program, no account, no internet.</p>
        """,
        False,
    ),
    (
        "This week",
        """
        <p>The week's two cards, as they print, on one screen. It follows whichever שבת is
        next and moves on by itself once Shabbos is over, so it is right on a Sunday morning
        without anyone touching it. <b>Previous</b>, <b>Today</b> and <b>Next</b> move around
        it by hand.</p>
        <p><b>Print both on one sheet</b> puts the two cards side by side on one landscape
        page. That has to be the program's job: the card is a fixed size here, so setting
        landscape in the printer dialog would change nothing.</p>
        <p><b>Print every week to the end of the season</b> does the same for every week
        left, which is the week by week pile for the year in one go.</p>
        <p>The cards are built from the saved boards, so a rule or a typed cell shows up here
        exactly as it does on the chart.</p>
        """,
        False,
    ),
    (
        "The luach for the congregation",
        """
        <p><b>lczmanim.cjaffa.com</b> shows one week at a time to anyone who opens it, with
        no login and nothing to install, and moves to the next week by itself once Shabbos is
        over.</p>
        <p>It cannot read what is saved here, because it is not on this computer. It reads a
        published copy of the season, so it shows what has been published and nothing
        else.</p>
        <p><b>To publish:</b> Settings, then Publishing, then Publish beside the season. A
        minute later the congregation's page is showing it. Publish once per season, and
        again after changing a time so they see the correction.</p>
        <p>It needs a token first, which is what allows the site to be written to. The
        Publishing box says how to make one. The token is kept in its own file rather than in
        the save file, and deliberately stays out of a backup: a backup gets shared, and a
        token that can write to the site must not.</p>
        <p>Publishing a season leaves every other published season standing, so קיץ and חורף
        can both be live and the changeover between them happens on its own. Publishing the
        same season again replaces it. <b>Take it down</b> removes one, and <b>What is live
        now</b> asks the site rather than guessing.</p>
        """,
        False,
    ),
    (
        "Rules: the difference between a one-off and every year",
        """
        <p>Typing over a cell changes <i>that board</i>. A <b>rule</b> changes <i>every board
        generated from now on</i>, which is what is wanted for something that comes back
        every year.</p>
        <p>Three are already there: שבת הגדול and שבת שובה add דרשה to the Mincha column, and
        ט באב marks the Shabbos when the fast starts מוצאי שבת. A rule can match a special
        Shabbos, a parsha, a date, a Hebrew date that comes round every year, or every
        week.</p>
        <p>One rule can cover both charts at once: tick the column on קיץ and on חורף. Rules
        can be switched off without being deleted.</p>
        <p>Rules and typed cells are applied when a board is opened rather than baked into
        it. A board keeps only which weeks it covers and how they split, so correcting a
        formula reaches every board already made.</p>
        """,
        False,
    ),
    (
        "Saved sheets, and Settings",
        """
        <p><b>Saved sheets</b> lists everything made. A שבת board and the Weekday chart made
        with it are one row: open either from it. Deleting a row deletes both, and asks
        first.</p>
        <p><b>Settings</b> holds the wording printed on the boards (the shul name, the
        rabbi's line, the daily שחרית schedule on the Weekday chart), where the shul is, and
        the offsets the calculations use. It is already set up for 44 Coles Way, so there
        should be no reason to touch the location unless something moves. The advanced zmanim
        settings are marked as best left alone, and that is meant.</p>
        <p>Rules, publishing and backups are on the same screen.</p>
        """,
        False,
    ),
    (
        "Where the work is kept, and how to move it",
        """
        <p>Boards, rules and settings are one file on this computer. A program run from a
        folder it can write to keeps that file beside itself, which is what lets a copy on a
        USB stick carry its own boards from one computer to another. Otherwise it goes in the
        usual per-user place for application data.</p>
        <p><b>Settings, then Backup, then Export backup</b> writes the lot as one file, and
        <b>Import backup</b> reads it back. That is how to move everything to another
        computer, and it is worth having a copy somewhere anyway.</p>
        <p>A backup is the same file the website's Settings exports, so one made there opens
        here and one made here opens there. The two programs work out the same times from the
        same data, so a board made in either is the same board.</p>
        """,
        False,
    ),
]


class GuideScreen(QWidget):
    """The guide, on a scroll, with a way through to the thing it is describing."""

    def __init__(self, window):
        super().__init__()
        self.window = window
        column = QVBoxLayout(self)
        column.setContentsMargins(28, 24, 28, 24)
        column.setSpacing(12)

        heading = QLabel("Guide")
        heading.setStyleSheet("font-size: 20px; font-weight: 700;")
        column.addWidget(heading)
        blurb = QLabel("What this is, and how to get a printed board out of it.")
        blurb.setWordWrap(True)
        blurb.setStyleSheet("color: #6b7280;")
        column.addWidget(blurb)

        lede = QLabel(
            "<p>This makes the printed <b>zmanim boards</b> for קהל לב מנחם: the שבת קיץ and "
            "שבת חורף charts and the matching Weekday chart. Every time on them is worked out "
            "for the shul's own location, so a new year's board takes a minute rather than an "
            "afternoon of editing last year's.</p>"
            "<p>It runs on its own. Nothing else has to be installed, nothing is sent anywhere, "
            "and it works with the internet off. The one thing that needs the internet is "
            "publishing to the congregation's page.</p>"
        )
        lede.setWordWrap(True)
        lede.setTextFormat(Qt.RichText)
        lede.setFrameShape(QFrame.NoFrame)
        column.addWidget(lede)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        holder = QWidget()
        inner = QVBoxLayout(holder)
        inner.setContentsMargins(0, 0, 12, 0)
        inner.setSpacing(8)
        self.sections = []
        for title, body, open_now in SECTIONS:
            section = Section(title, body.strip(), open_now)
            self.sections.append(section)
            inner.addWidget(section)
        inner.addStretch(1)
        scroll.setWidget(holder)
        column.addWidget(scroll, 1)

        start = QPushButton("Make a board →")
        start.clicked.connect(lambda: window.show_screen("generate"))
        column.addWidget(start, 0, Qt.AlignLeft)
