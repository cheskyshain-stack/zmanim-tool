# Bais Medrash of Lakewood Commons

Kahal Lev Menachem (קהל לב מנחם), 44 Coles Way, Lakewood, NJ 08701.

[Support the shul and donate](https://baismedrashoflakewoodcommons.org/donate/).

## Development

The separate organizer tool at `/seats/` is linked from the admin home and sidebar.
Its PIN is separate from the existing admin PIN. It starts with columns of 8, 9,
9, and 8 tables, with the extra middle tables at the back. Tables start with five
seats, except A7, A8, D7, and D8, which have three. Width follows seat count, using
five seats as the standard size. Table labels appear above the table surfaces.
Set counts individually or by column, then add people manually or import the first
worksheet of an Excel file, CSV, TSV, or a text file with one name per line.
Click a seat and type a name, choose a suggested existing person, or copy and paste
a name into a separate seat for a child. Copying creates a separate person record
and keeps the original assignment. Choosing an already seated suggestion moves
that person. Enter saves; Tab saves and advances. Undo and Redo also support
Ctrl/Cmd+Z, Ctrl+Y, and Ctrl/Cmd+Shift+Z outside text inputs.
Names are drawn inside the tables; small chairs are on one side facing the Aron.
The first row touches the front wall, A1 through A6 touch the left wall, and a
central bimah is included. A walkway separates rows 6 and 7, with an entrance in
each side wall. Two doors at the back, between A/B and C/D, are marked usually closed.
Tables, pillars, sefarim cabinets, labels, and a bimah can be added and moved with
dragging a table label or room object, or using keyboard arrows. Width, depth,
and position can also be entered. The page scrolls normally over the sidebar
and tables; touch dragging is limited to labels and room objects.

Seats saves its own versioned plans in `lakewood-commons-seats-v1`, separately from
schedule settings. Nothing uploads to a server. Download a backup to move plans
between devices. Restore adds plans instead of replacing current ones, and Undo
can reverse edits and imports. Letter landscape and 17 x 11 inch printing support
black-and-white or color; match the selected paper size in the browser print dialog.
The build stamps `seats/index.html` and includes it in `dist/`, outside public
routing and the sitemap, with `noindex` and a robots exclusion.
Older plans migrate to the revised room layout while retaining names and existing
seat counts, except the four explicitly three-seat rear tables. Any excess names
return to the waiting list. The browser keeps the original pre-update JSON in
`lakewood-commons-seats-v1-before-room-v2` before changes are saved.

Verify the tool with `node --test tests/seats-model.mjs` and
`node tests/seats-browser.cjs` after building `dist/`. The browser check generates
actual one-page Letter and Tabloid PDFs and checks their sizes and names.

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
