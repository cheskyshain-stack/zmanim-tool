# Bais Medrash of Lakewood Commons

Kahal Lev Menachem (קהל לב מנחם), 44 Coles Way, Lakewood, NJ 08701.

[Support the shul and donate](https://baismedrashoflakewoodcommons.org/donate/).

## Development

The separate organizer tool at `/seats/` is linked from the admin home and sidebar.
Its PIN is separate from the existing admin PIN. It starts with columns of 8, 9,
9, and 8 tables, with the extra middle tables at the back. Tables start with five
seats, except A7, A8, D7, and D8, which have three, and B2, C2, B5, C5, B6, and C6,
which have four. Width follows seat count, using
five seats as the standard size. Table labels appear above the table surfaces.
Tables use 48 units per seat, about 12% wider than the original 43. Names wrap
between whole words, with a smaller font when necessary; exceptionally long names
still show the fit warning so their table can be enlarged before printing.
Standard tables are 40 units high with 48 units between all ordinary rows. The
standard A-D rows use the common grid, with names, counts and custom sizes retained.
Added tables keep their positions. The main walkway between rows 6 and 7 stays clear.
Set counts individually or by column, then add people manually or import the first
worksheet of an Excel file, CSV, TSV, or a text file with one name per line.
The importer finds name headers beneath up to 49 title/note rows, so directory
files can include house numbers before First name and Last name. Numeric-only
entries are skipped. The tool opens directly to the names and chart. The default
plan is 7:30 מנין;
old Main shul plan names update without changing custom plan names. Delete beside
a name removes one person. Delete names opens checkboxes for selecting
people, including those already seated. Select all shown follows the search;
Delete all names clears the current plan's full list. Deletion clears the affected
seats, preserves the room, and supports Undo and Redo.
Click a seat and type a name, choose a suggested existing person, or copy and paste
a name into a separate seat for a child. Copying creates a separate person record
and keeps the original assignment. Choosing an already seated suggestion or list
name adds a separate copy and keeps the original seat. Reopening and saving the
same seat keeps its existing record. Each copy can be renamed independently.
Enter saves; Tab saves and advances. Undo and Redo also support
Ctrl/Cmd+Z, Ctrl+Y, and Ctrl/Cmd+Shift+Z outside text inputs.
On desktop, Seats keeps the list beside the chart within the viewport.
Drag a list name onto a seat to add it, keeping any existing assignment. Drag
an assigned name directly between chart seats to move it. Ctrl/Option
drag creates a separate copy for another person, and dropping an assigned name back
in the list frees its seat. An occupied destination returns its former occupant to
the waiting list. Undo/Redo also covers these changes. Fit shows the whole room;
100% and plus/minus zoom within the chart pane while the names remain visible.
Upload names stays visible, with manual entry, seat lists and backups under
Add names & other tools. Phone tap-to-assign and page scrolling are retained.
Names are drawn inside the tables; small chairs are on one side facing the Aron.
The rav's separate, assignable chair faces the room across its square shtender. It sits
between the Aron Kodesh and C1; C1 touches D1. The Aron Kodesh stays centered on
the front wall, independently of table movement and resizing. Front tables leave
room for it and the Rav's seat, with automatic C1/D1 widths fitted to that space
when extra seats are requested. An amud stands between B2 and C2.
B2/B5/B6 align with the left edges of their columns, and C2/C5/C6 with the right edges,
leaving more space beside the amud and bimah.
The middle columns sit closer together so the three main aisle gaps are equal
beside standard five-seat tables. The shorter tables retain extra clearance around
the amud and bimah; C1 still touches D1 at the front.
Tables near the front and side walls have a small visual gap from the wall.
The back-right tables also leave a gap beside the side bookcase. A central bimah
is included. The amud has a plain surface without a decorative symbol.
A walkway separates rows 6 and 7, with row 7 meeting its back edge and an entrance in
each side wall. These are open passages without door leaves or swings. Two doors
at the back, between A/B and C/D, remain in the drawing. Sefarim bookcases line
the back wall between and outside those doors, and continue along both side walls
to the front of row 8. Clear walkways run across the entire back and to the left
of A7/A8 and D7/D8. A7/A8 align with the right edge of A6; D7 and D8 share the
right edge with a small gap before the bookcase face. The three back-wall cabinets are fixed
against dragging, resizing, or removal, with wider clearances beside both doors.
Built-in cabinet, walkway, entrance and door labels are hidden on screen and in
print. Walkway guide lines are hidden too, and selection outlines are solid.
The same gap separates table rows from front to back, with a wider entrance walkway
between rows 6 and 7. Rows 7, 8 and 9 share the front rows’ spacing. The back walkway
is 48 units deep. Side bookcases still reach the front of row 8.
The separate Edit layout tab is removed. Table & room settings remain tucked under
Add names & other tools. Open those settings to add tables, pillars, sefarim cabinets,
labels, and a bimah. Move them by dragging labels or room objects, or with keyboard
arrows. Close the settings to keep
room positions fixed while assigning names. Width, depth,
and position can also be entered. The page scrolls normally over the sidebar
and tables; touch dragging is limited to labels and room objects. Pinch with two
fingers to zoom the chart, or use plus/minus, 100%, and Fit. One finger scrolls
the page or pans across an enlarged chart.

Seats saves its own versioned plans in `lakewood-commons-seats-v1`, separately from
schedule settings. Nothing uploads to a server. Download a backup to move plans
between devices. Restore adds plans instead of replacing current ones, and Undo
can reverse edits and imports. Letter landscape and 17 x 11 inch printing support
black-and-white or color. Initial setup defaults to Printer paper (auto fit), which
fills the printable width and height of the paper chosen in the native print dialog,
including Letter, 11 x 17, Legal, A4 and A5 landscape. Names keep their normal
lettering proportions and the Rav’s shtender stays square. Auto fit uses a 0.35 inch
margin. Explicit Letter and 11 x 17 choices retain fixed-size PDF output with
printer-safe margins of 0.35 and 0.5 inch respectively. Existing paper preferences
are retained; choose Printer paper (auto fit) to fill a different native paper size.
Older browsers without print container sizing retain a proportional chart.
The sheet also shrinks to fit the browser’s available printable area.
Only the plan title prints above the chart.
Match both paper size and Landscape in
the browser print dialog, including Android's separate native paper-size picker.
The build stamps `seats/index.html` and includes it in `dist/`, outside public
routing and the sitemap, with `noindex` and a robots exclusion.
Version 11 plans receive an 8-unit inset for wall-side tables. The row grid shifts
back by the same small amount, retaining names, counts, sizes and the equal row gaps.
Bookcases stay in their existing positions against the walls. Front table labels
stay above the wall line. Version 10 plans redistribute the standard rows using one common gap, keeping
names, assignments, sizes and horizontal positions. The main amud and original
bimah follow their adjacent rows, and side bookcases follow row 8. Version 9 plans
spread standard rear rows into the reduced back walkway, retaining
names, assignments, custom sizes, and manually spaced rows. Version 8 plans center
the Aron, refit its adjacent front tables and Rav's seat,
and shorten standard tables with matching row gaps, preserving names, assignments,
and unrelated layout edits. Version 7 plans also
move rows 8 and 9 forward to match the normal table gaps, retaining
names, counts, table sizes and horizontal positions. Version 6 plans also
rebalance the B/C column positions while retaining names, seat
counts, table sizes, and the outer columns. Plans from version 5 or earlier also
widen automatic tables and reduce B5/C5 to four seats, retaining
all names. Anyone in those removed fifth seats returns to the waiting list. Manual
table sizes are retained. Version 4 plans also receive the row 7 and back-cabinet
updates while retaining names,
seat counts, and other custom positions. Version 3 plans also receive the table
alignment changes. Older plans also receive the revised room
layout and explicitly three-seat and four-seat tables; any excess names return to
the waiting list. The browser keeps the original pre-update JSON in
`lakewood-commons-seats-v1-before-room-v12` before changes are saved. Earlier room
snapshots are retained when present. Backups and seat-list exports include the rav's seat.

Verify the tool with `node --test tests/seats-model.mjs` and
`node tests/seats-browser.cjs` after building `dist/`. The browser check generates
actual one-page Letter and Tabloid PDFs and checks their sizes, names, safe margins,
and lettering proportions, alongside touch zoom and scrolling.
`node tests/seats-desktop.cjs` checks desktop pane fitting, native drag/drop,
seat-to-seat moves, copying, returning names to the list, autoscroll and cancel.
`node tests/seats-print.cjs` checks all page edges and corner-seat names in native
Letter and Tabloid PDFs, Tabloid fitted to Letter, and larger printer margins,
from both phone and desktop layouts. It also checks automatic Letter, Tabloid,
Legal, A4 and A5 page filling, normal and rotated lettering proportions, and the
square Rav shtender in actual PDFs. These print checks require Chromium,
Playwright, Poppler, Pillow and PyMuPDF.

A local web tool that generates printable שבת קיץ / שבת חורף shul zmanim boards,
ported from `Lakewood Commons Zmanim tables.xlsx`.

## Running it

**Easiest way:** double-click `Start.bat` in this folder. It starts a local server
in its own window and opens the app in your default browser. Leave that window open
while you use the app; closing it stops the server. Next time, just double-click
`Start.bat` again.

**Manual way:** this is a static site (no build step), but it loads its data files
(`data/*.json`) with `fetch()`, which browsers block from a `file://` page, so it needs
to be served rather than opened directly:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/`. (Any other static file server works too.)

To put it online later: upload this folder as-is to GitHub Pages, Netlify, or any
static host - nothing needs to change.

## Fully offline (USB drive / no internet / no local server)

The `offline/` folder is a self-contained copy that needs **nothing** - no server,
no internet, not even the `Start.bat` step above. Copy the whole `offline/` folder to
a USB drive, plug it into any computer, and double-click `offline/index.html`; it opens
straight in the default browser and works completely offline from then on (all your
data still saves locally in that browser, same as the regular version).

This works because `offline/bundle.js` has everything - every `.js` file and the
Hebrew-calendar data tables - bundled into one plain script, instead of the ES modules
and `fetch()` calls the regular version uses (both of those are blocked when a page is
opened directly as a file instead of served over a URL).

If you change anything under `js/`, `css/`, `data/`, or `assets/`, regenerate the
offline copy before recopying it to a USB drive:

```bash
python build-offline.py
```

## Putting it on a phone's home screen

Open the site, then **Add to Home screen** (Chrome's menu on Android, the Share button on
an iPhone). It gets the LC Shul Zmanim icon and opens the same as it does now, in the
browser, with all its printing and sharing.

The icons in `icons/` are built from `icons/source.png`. To change the artwork, replace
that file and run:

```bash
python make-icons.py
```

It needs Pillow (`pip install pillow`), which nothing else here does. Everything else in
`icons/`, plus `favicon.ico` and `assets/logo-text-navy.png`, is its output: don't edit
those by hand.

## How your data is stored

Everything (Settings, generated sheets with their per-cell overrides, and Rules) is
saved in this browser's local storage - nothing is sent anywhere. Use **Export backup**
in the header to save a JSON file, and **Import backup** to restore it (e.g. on another
computer, or after clearing browser data).

## Public schedule API

`GET https://baismedrashoflakewoodcommons.org/api/schedule.json` is a public,
read-only JSON feed. It needs no API key and supports cross-origin browser fetches.
It contains exactly ten calendar dates: the build's current day and the following
nine days, in `America/New_York`. It accepts no date or range parameters. Room names,
addresses, coordinates, stars, and underline location markings are omitted.

The feed refreshes on every main deployment and daily after New York midnight.
GitHub's scheduled deployments can be delayed. Consumers must check `generatedAt`
and require `range.startDate` to match today's date in `timeZone` before displaying
it as the current ten-day feed. Fetch again when the response is stale; do not
extend or infer schedules beyond `range.endDate`.

The response has `schemaVersion`, `generatedAt`, `timeZone`, `range`, and `days`.
Each day includes its ISO `date`, `weekday` (Saturday is named `Shabbos`), `parsha`,
`hebrewDate`, `occasions`, `status`, and `events`. Hebrew month numbers follow the
calendar engine: Nissan is 1, Tishrei is 7. Leap-year Adar follows the engine's
13/14 numbering. Event `time` is local 24-hour `HH:mm`; `displayTime` adds AM/PM.
`name` is the Hebrew schedule label, `category` is `shacharis`, `mincha`, `maariv`,
or `other`, and an optional `reckoning` identifies a zman's opinion. Calendar days
include their full schedule, even after a service has passed. Midnight events are
filed under their actual calendar date. Identical events in different rooms appear
once. `unconfirmed` or `unavailable` days must not be treated as ordinary schedules.

```js
const response = await fetch('https://baismedrashoflakewoodcommons.org/api/schedule.json', {
  cache: 'no-cache',
});
if (!response.ok) throw new Error('Schedule unavailable');
const schedule = await response.json();
const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: schedule.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(new Date());
const part = type => parts.find(p => p.type === type).value;
const today = `${part('year')}-${part('month')}-${part('day')}`;
if (schedule.schemaVersion !== 1 || schedule.range.startDate !== today) {
  throw new Error('Schedule needs refreshing');
}
const days = schedule.days;
```

Build the API after the ordinary site build with Node.js 24:

```bash
python build-offline.py
node scripts/build-schedule-api.mjs
node --test tests/schedule-feed.mjs
```

The generated `dist/api/schedule.json` is build output and is not committed. Its
adapter uses the same weekly reader, holiday posters, and chart calculations as
the public site.

## Rules vs. overrides

- Chart cells are read-only. **Overrides** from older saved sheets and imported backups
  are still displayed and remain tied to their original sheet.
- **Rules** (the Rules tab) are reusable and apply automatically every time you
  generate a sheet - use these for recurring exceptions like Shabbos Teshuva / Shabbos
  HaGadol having a different Mincha time because of the drasha.

## What's ported from the workbook vs. simplified

- Astronomical zmanim use the workbook's FUNCTIONS sheet, named formulas, SETTINGS
  and time-zone table. The two chart tabs are schedule/layout examples. The saved
  calculation reference and independent formula checks are described in [fixtures/README.md](fixtures/README.md).
- The Hebrew calendar (dates, parsha-of-week, special Shabbosim) is also fully
  self-contained, ported from the workbook's own calendar tables/formulas - no
  external calendar library or internet connection required.
- The timezone list is a small curated set (not the workbook's full 510-zone table).
- The full-year "Shabbos & Yom Tov Calendar" sheet, Daf Yomi, and Tachanun-day logic
  are not included yet - flagged as a follow-up.
