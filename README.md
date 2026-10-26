# Bais Medrash of Lakewood Commons

Kahal Lev Menachem (קהל לב מנחם), 44 Coles Way, Lakewood, NJ 08701.

[Support the shul and donate](https://baismedrashoflakewoodcommons.org/donate/).

## Development

The separate organizer tool at `/seats/` is linked from the admin home and sidebar.
Its PIN is separate from the existing admin PIN. After unlocking, the home page
offers Create new chart and View saved charts. With 7:30 minyan as the only
available room, these buttons skip location selection. Create opens the standard
empty layout and the Name files chooser; the chooser can be closed to enter names
manually. View saved charts opens all existing setups directly. Existing device
drafts remain available, and opening Seats again
returns to home. Direct links to a shared chart still open that chart.
The standard layout has columns of 8, 9,
9, and 8 tables, with the extra middle tables at the back. Tables start with five
seats, except A7, which has three, and C1, A8, B2, C2, B6 and C6,
which have four. The room has 163 seats including the Rav's seat. Width follows seat count, using
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
entries are skipped. The room is called 7:30 minyan. New chart titles use the
current New York date, such as Seating plan - Oct 26, 2026. Additional charts made
on the same date get a numbered suffix. Exact older room-only chart titles use
their last-edit date, creation date or today's date when those dates are unknown.
Custom titles remain unchanged. More > Use today’s date suggests a current date
name, which can be edited for an occasion or other useful detail. Delete beside
a name removes one person. Delete names opens checkboxes for selecting
people, including those already seated. Select all shown follows the search;
Delete all names clears the current plan's full list. Deletion clears the affected
seats, preserves the room, and supports Undo and Redo.
The Sort names selector orders the list by First name or Last name, ignoring common
titles and suffixes. The choice is remembered on the device and also orders the
downloaded seating list. Displayed names and seat assignments stay unchanged.
Click a seat and type a name, choose a suggested existing person, or copy and paste
a name into a separate seat for a child. Copying creates a separate person record
and keeps the original assignment. Choosing an already seated suggestion or list
name adds a separate copy and keeps the original seat. Reopening and saving the
same seat keeps its existing record. Each copy can be renamed independently.
Enter saves; Tab saves and advances. Undo and Redo also support
Ctrl/Cmd+Z, Ctrl+Y, and Ctrl/Cmd+Shift+Z outside text inputs.
On desktop, Seats opens the chart at the full available width and keeps the list
beside it. Scroll vertically inside the chart to reach the back of the room.
Drag a list name onto a seat to add it, keeping any existing assignment. Drag
an assigned name directly between chart seats to move it. Ctrl/Option
drag creates a separate copy for another person, and dropping an assigned name back
in the list frees its seat. An occupied destination returns its former occupant to
the waiting list. Undo/Redo also covers these changes. The view selector offers
Full width, Whole chart, and 100%; plus/minus zoom within the chart pane.
Name files stays visible, with manual entry, seat lists and backups under
Add names & other tools. Phone tap-to-assign and page scrolling are retained.
Names are drawn inside the tables; small chairs are on one side facing the Aron.
The rav's separate, assignable chair faces the room across its square shtender. It sits
between the Aron Kodesh and C1; an 8-unit gap separates C1 and D1. D1 keeps the
same small gap from the right wall as the other front tables. A plain opening
beside it has no door leaf or swing. The Aron Kodesh stays centered on
the front wall, independently of table movement and resizing. Front tables leave
room for it and the Rav's seat, with automatic C1/D1 widths fitted to that space
when extra seats are requested. An amud stands between B2 and C2.
B2/B5/B6 align with the left edges of their columns, and C2/C5/C6 with the right edges,
leaving more space beside the amud and bimah.
The middle columns sit closer together so the three main aisle gaps are equal
beside standard five-seat tables. The shorter tables retain extra clearance around
the amud and bimah. The bimah is slightly farther back, clear of the fifth-row
tables and chairs, while B5 and C5 keep their standard column alignment.
Tables near the front and side walls have a small visual gap from the wall.
The back-right tables share the same right edge. A central bimah
is included. The amud has a plain surface without a decorative symbol.
A walkway separates rows 6 and 7, with row 7 meeting its back edge and an entrance in
each side wall. These are open passages without door leaves or swings. Two doors
at the back, between A/B and C/D, remain in the drawing. Sefarim bookcases line
the back wall between and outside those doors, and continue along both side walls
to just behind the A8/D8 chairs, with an 8-unit gap. Clear walkways run across the entire back and to the left
of A7/A8 and D7/D8. A7/A8 align with the right edge of A6; D7 and D8 share the
right edge with a small gap before the bookcase face. The three back-wall cabinets are fixed
against dragging, resizing, or removal, with wider clearances beside both doors.
Built-in cabinet, walkway, entrance and door labels are hidden on screen and in
print. Walkway guide lines are hidden too, and selection outlines are solid.
The same gap separates table rows from front to back, with a wider entrance walkway
between rows 6 and 7. Rows 7, 8 and 9 share the front rows’ spacing. The back walkway
is 48 units deep. Side bookcases stay attached to the walls behind the last outside tables.
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
schedule settings. Local plans stay on the device. Download a backup to move plans
between devices. Restore adds plans instead of replacing current ones, and Undo
can reverse edits and imports. Letter landscape and 17 x 11 inch printing support
black-and-white or color. Initial setup defaults to Printer paper (auto fit), which
fills the printable width and height of the paper chosen in the native print dialog,
including Letter, 11 x 17, Legal, A4 and A5 landscape. Names keep their normal
lettering proportions and the Rav’s shtender stays square. Auto fit uses a 0.35 inch
margin. Auto fit anchors the sheet to the printable page instead of the browser
viewport, preventing an oversized sheet from flowing onto a second page.
Explicit Letter and 11 x 17 choices retain fixed-size PDF output with
printer-safe margins of 0.35 and 0.5 inch respectively. Existing paper preferences
are retained; choose Printer paper (auto fit) to fill a different native paper size.
Older browsers without print container sizing retain a proportional chart.
The sheet also shrinks to fit the browser’s available printable area.
Only the plan title prints above the chart.
Match both paper size and Landscape in
the browser print dialog, including Android's separate native paper-size picker.
The build stamps `seats/index.html` and includes it in `dist/`, outside public
routing and the sitemap, with `noindex` and a robots exclusion.
The current room update keeps the compatible stored layout version 12. Old joined
C1/D1 tables identify charts that need the new seat counts and front-door clearance.
Standard side bookcases and the original bimah also receive their revised positions.
The earlier door-swing inset at D1 returns to the normal small wall gap, with
custom seat counts and sizes retained.
C1's displaced fifth-seat name stays in the waiting list; added seats are empty.
Updates to a shared chart are emitted as ordinary count/geometry changes after its
server snapshot is registered, preserving online assignments and edit history.
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
widen automatic tables while keeping B5/C5's fifth-seat assignments. Manual
table sizes are retained. Version 4 plans also receive the row 7 and back-cabinet
updates while retaining names,
seat counts, and other custom positions. Version 3 plans also receive the table
alignment changes. Older plans also receive the revised room
layout and explicitly three-seat and four-seat tables; any excess names return to
the waiting list. The browser keeps the original pre-update JSON in
`lakewood-commons-seats-v1-before-room-right-opening-2026-10-26` before changes are saved.
Original shared snapshots receive a separate backup with their local chart ID. Earlier room
snapshots are retained when present. Backups and seat-list exports include the rav's seat.

Charts save locally as they are edited. The main actions are Save and Saved charts,
beside Print. The chart name is editable inline. Save uploads the current chart to
the website once; later edits save there automatically. Anyone signed in can open
the chart from Saved charts and edit it. There is no separate sharing step.
The folder shows chart names, creation dates, last-edit dates and the last editor.
New chart inside the folder opens a fresh layout directly. Seats home returns to the
start page; history and backup downloads are under More.
The PIN just entered to open Seats is reused in memory for the first server sign-in;
the organizer supplies their name for history. The PIN is not saved to browser storage.
Name files opens a shared folder with Upload names and reusable saved lists.
Uploading Excel, CSV or text adds its names to the current chart and automatically
saves a named file on the website, even if the chart itself has not been saved
online. Other organizers can choose the file to add its names to another chart;
existing names and assignments stay in place. Uploads waiting for connectivity
are saved locally and retried with the same ID, so a lost response creates no
duplicate file. Pending uploads can be deleted too.
Each name file and chart card has a Delete control. Deleting a shared file removes
it from everyone's website folder. Deleting a name list keeps names already used
on charts. A deleted chart stays available as a local copy on devices that had it
open, including unsynced offline edits; reconnecting does not recreate the file.
Device copies can be deleted separately.
Each accepted shared edit records the organizer, time and changed names, seats or
settings in the server history. History is paginated and Undo adds its own entry.
Older charts whose creation date was never recorded show Not recorded. Local
dates and the 200 most recent local changes use a separate browser record; backup
downloads include those records and restores retain known creation dates.
Committed edits appear live, with the other organizer's name and active seat. Independent
seat changes merge, Undo affects only that organizer's edits, and conflicting
offline changes are kept as a separate local copy. Restoring a backup creates
independent local plans. Shared editing stays disabled until its Cloudflare service
is deployed and `data/seats-sync.json` points to the verified service. See
`worker/seats/README.md` for deployment and the activation workflow.

Verify the tool with `node --test tests/seats-model.mjs` and
`node tests/seats-browser.cjs` after building `dist/`. The browser check generates
actual one-page Letter and Tabloid PDFs and checks their sizes, names, safe margins,
and lettering proportions, alongside touch zoom and scrolling.
`node tests/seats-start.cjs` checks the home page, direct chart actions, name chooser,
existing drafts, canonical new layouts and return navigation on phone and desktop.
`node --test tests/seats-name-sort.mjs` and `node tests/seats-name-sort.cjs` check
first/last-name ordering, unchanged assignments, exports, device preference, focus,
scroll and the undistorted PIN photo. `tests/seats-room-sharing.cjs` uses local
Workerd and two browser organizers to verify one real legacy-room migration patch
and no repeat after reload, with the displaced C1 name retained.
`node tests/seats-desktop.cjs` checks desktop pane fitting, native drag/drop,
seat-to-seat moves, copying, returning names to the list, autoscroll and cancel.
`node tests/seats-print.cjs` checks all page edges and corner-seat names in native
Letter and Tabloid PDFs, Tabloid fitted to Letter, and larger printer margins,
from both phone and desktop layouts. It also checks automatic Letter, Tabloid,
Legal, A4 and A5 page filling, normal and rotated lettering proportions, and the
square Rav shtender in actual PDFs, including 125% and 150% browser zoom.
These print checks require Chromium,
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
