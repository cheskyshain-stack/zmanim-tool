# Working on this project

Printable zmanim boards for קהל לב מנחם (Bais Medrash Lakewood Commons, 44 Coles Way,
Lakewood NJ). Three charts: שבת קיץ, שבת חורף, and a Weekday chart. Ported 1:1 from
`../Lakewood Commons Zmanim tables.xlsx`, which is NOT in this repo but is the source of
truth for every calculation. If a number looks wrong, the workbook decides, not a zmanim
library.

Live at https://baismedrashoflakewoodcommons.org (GitHub Pages from `main`, CNAME in the repo).
It was on lczmanim.cjaffa.com until the shul took a domain of its own. The address is written
in `SITE_URL` in `build-offline.py` and in `CNAME`, and everything else is stamped from there.
Read `README.md` for how a user runs it. This file is about changing it.

## Ground rules

**No em dashes.** Anywhere. Not in the interface, not in comments, not in commit
messages, not in replies to the user. This was an explicit instruction and the entire
codebase was swept once to remove them. Use a comma, a colon, parentheses, or two
sentences.

**Verify in a real browser, do not reason about it.** Especially for anything involving
Hebrew, row heights, or print layout. Several confident conclusions in this project's
history turned out to be wrong and had to be retracted. Measure with
`getBoundingClientRect`, then say what you measured.

**The user prints these boards.** A visual regression on paper is a real cost, not a
cosmetic one. Layout invariants below are not preferences.

## Deploy loop

Every change follows this, in order:

1. Edit `js/`, `css/`, `index.html`, `data/`, or `assets/`.
2. `python build-offline.py` (always, even for CSS only, see below), followed by
   `node scripts/build-schedule-api.mjs` with Node.js 24 to generate the public API.
3. Serve and test locally on a **fresh, unused port**: `python -m http.server 8907`.
   Reusing a port you served from earlier in the session gets you a cached page and a
   false pass.
4. `git add -A && git commit && git pull origin main --no-edit && git push origin main`
5. Poll the live site until the change is actually there. The workflow builds and then
   deploys, so give it about two minutes:
   `curl -s "https://baismedrashoflakewoodcommons.org/?b=$(date +%s)" | grep -o 'app.css?v=[0-9a-f]*'`
   and compare against the local `index.html`. Do not tell the user it is live until the
   hash matches.

### build-offline.py does seven jobs

Run it after **any** change to `js/`, `css/`, `data/`, or `assets/`:

- Builds `offline/`, a self-contained copy for a USB stick. It flattens every module into
  one plain script (no ES modules), inlines `data/*.json` (no `fetch`), and inlines the
  webfonts as base64 data URIs. All three of those are blocked under `file://`.
- Stamps `css/*.css` links in `index.html` with a content hash.
- Generates the JS **import map** in `index.html`, giving every module a content-hashed
  URL.
- Stamps the whole-address tags (canonical, `og:url`, `og:image`) from `SITE_URL`, the one
  place the domain is written. Moving to another domain is that line and a rebuild.
- Writes `dist/`, **the copy of the site that gets published**, with every comment taken out.
  `dist/` is gitignored and is built again by `.github/workflows/pages.yml` on every push to
  `main`, which is what deploys it. Pages will only publish a branch root or `/docs`, so
  reaching `dist/` at all is why that workflow exists rather than a setting. For a long time it
  did not, the root was published, and every comment here was on the live site.
  **Comments live in this repository and must not reach a browser.** They were 54% of what
  a visitor downloaded and they carry the reasoning behind every decision here. The
  strippers scan rather than pattern-match, because `accept="image/*"`, `data/*.json` and
  `https://secure.cardknox.com/...` all look like comments to a regex and breaking any of
  them is silent. The build refuses to write `dist/` if its own scanners still find a
  comment in the output. `/*!` licence banners are kept and `vendor/` is copied byte for
  byte. HTML comments written into markup by the JS are stripped too: they become real
  comment nodes in the DOM and are just as readable in devtools.
- Stamps the analytics loader into `index.html` from `ANALYTICS_TOKEN`, before the route pages
  are written so they inherit it. Empty means nothing is written and anything an earlier run
  wrote is taken out, so turning analytics off is emptying that line. The online `/admin/`
  also carries a loader, which waits for `zmanim-admin-open` after the PIN is accepted or
  remembered. Its `spa: false` setting counts document opens, not changes between tabs.
  The offline build strips the loader, so a USB stick never sends analytics.
  It is a loader rather than the beacon's own tag because the answers to "who is
  being counted" have to be given before the request goes out. It asks for the beacon only when
  `location.hostname` is `SITE_URL`'s own host, so a local `python -m http.server` and any
  preview count nothing, and only when this browser has not asked to be left out. **Opening the
  live site once with `?count=off` marks that device and it stops being counted; `?count=on`
  undoes it.** The mark is `zmanim-nocount` in localStorage, per device and per browser like the
  admin's unlock, and it is lost when site data is cleared. A browser that refuses localStorage
  is counted rather than broken.
  Measure this the way it was measured the first time, since the beacon is not reachable from a
  container: run Chromium with `--host-resolver-rules=MAP baismedrashoflakewoodcommons.org 127.0.0.1:<port>`
  and watch whether the page asks for `static.cloudflareinsights.com` at all.
- Writes `week/`, `chart/` and `donate/` out of `index.html`, and `sitemap.xml` with them.
  Those three folders and the sitemap are **build output**: do not hand-edit them, the same
  as the import map and `offline/`. The per-page titles and blurbs live in the `ROUTES`
  table at the top of the script, which is the only place to change them.

`make-icons.py` is separate and is **not** part of the deploy loop. It builds `icons/*`
and `favicon.ico` from `icons/source.png`, plus `assets/logo-text-navy.png` from the black
`assets/logo-text.png`, needs Pillow, and is only run when the artwork itself changes.
The navy wordmark is a real file rather than a CSS trick on purpose: a mask over an
`<img>` only clips it and the black artwork still paints through, and the filter chain
that fakes a tint is a row of magic numbers nobody can check. The icon links live in the head of both `index.html` and
`admin/index.html`; the admin one is wrapped in `<!-- icons --> ... <!-- /icons -->` and
`build-offline.py` strips that block, because the paths are site absolute and a web
manifest cannot be fetched over `file://` at all.

Both manifests carry `"display_override": ["standalone"]` **and** `"display": "browser"`,
and that pair is load-bearing, not a leftover. Android reads `display_override`, so Chrome
installs the site as a real app: no Chrome badge on the icon, and the launcher gets the
maskable icon instead of zooming and cropping the plain one. Safari does not implement
`display_override` and falls through to `browser`, so an iPhone keeps opening it in Safari
with the address bar, because a standalone window on an iPhone cannot print at all.
Collapsing the two into a plain `"display": "standalone"` would take printing away from
every iPhone that has it on a home screen. Ask Chrome rather than guessing at any of this:
CDP `Page.getInstallabilityErrors` names the reason a site will not install, and it has to
be run in a persistent profile or the only answer you get is `in-incognito`.

The user has said the offline copy does not need to keep gaining new features, so do not
contort a design to fit it. Keep running `build-offline.py` regardless: the cache
stamping the live site depends on happens in the same script.

The import map exists because GitHub Pages serves everything with a 10 minute max-age.
Stamping only the entry would not reach the modules it imports, and the mismatch bit us
for real: a phone ran new CSS against 10 minute old JS and showed the wrong thing, which
reads as "your fix didn't work". Never hand-edit the import map or anything in
`offline/`; both are build output.

## Layout invariants for the charts

The standard chart palette uses neutral gray (`#cecece`) with neutral borders and
shadows, plus black print text on white paper. Upgrade the old blue-gray default in
saved charts and published settings. Black and white mode sets gray colour values
directly, preserving PDF text; CSS grayscale filters rasterize the tables and text.
`tests/chart-print-colors.cjs` checks actual PDF colours and selectable text in both
ink modes, including saved defaults and a custom colour.

The Chanukah morning block uses a light neutral 4% gray (`#f5f5f5`). Draw it as
decorative SVG artwork behind selectable text as well as a CSS background, so browsers
can retain it when background graphics are disabled. Add the artwork after building the
schedule grid; it must not change time parsing, explanations or chart geometry.
Center the standing weekday Shacharis information and the Chanukah addition together
as one block in the white panel, with the usual small gap between their schedules.
`tests/chart-print-colors.cjs` checks its pixels with background printing disabled and
economy colour adjustment on desktop and phone PDFs. Printer toner-saving controls can
still change how light shading appears on paper.

Erev Shabbos Chanukah uses the regular Friday main Mincha list. The extra 12:15
candidate, usually held back to 12:20, was removed at the shul's request. Keep it off
the seasonal charts, Chanukah poster, weekly agenda, and Erev Shabbos message.

Admin Chanukah posters use a 5.5in by 8.5in handout on landscape Letter paper only
under **All on one**. **Just one** and **A sheet each** keep the original full-page
portrait poster, including its original headings, spacing and location notes; they
never show or apply the Copies per page switch, even when two copies was remembered.
The original poster's last schedule block has no trailing margin; the legend provides
the gap so its location notes stay clear of the frame even with six sunrise references.
The remembered **Copies per page** switch selects one copy on the left with the other
half blank, or two identical copies side by side for a manual cut. The default is one;
both choices keep the same design and physical size. Keep Shacharis together,
including all sunrise day labels in a compact strip, followed by Mincha, Maariv and
Erev Shabbos. Retain every time, merged Friday value and location note. Fit the type
at full size and refit when fonts arrive; a phone's preview zoom must not reach paper.
Mixed whole-year runs keep portrait Letter paper and rotate the half-size handouts
onto the top half, or both halves, of their own page. Public Special Schedules keep their full-page layout.
`tests/chanukah-half-letter.cjs` checks seven years, phone and desktop PDFs, margin
controls, all three sheet modes, one and two copies, remembered choices, content retention
and mixed-run pagination.

The after-Sukkos extra 9:00 Maariv is kept through Thursday, October 8, 2026 in Lakewood
and omitted from Friday onward, including future years previewed before that date.
`buildSukkosAfter` applies the cutoff to the shared list read by posters and weekday
charts. The after-Yom-Kippur and Chol Hamoed lists keep their own 9:00 minyanim.

The admin's **Explain times** switch stays available on every tab. Shared chart, week and
poster renderers register their own time traces through `ui/time-explanations.js`; the
congregation's page never installs that registry and emits no inspector markup. Clicks
use measured text ranges to select one time inside a cell, without wrapping or changing
chart text. All seasonal and weekday chart cells are read-only, including admin print
layouts and saved copies. Tapping a chart cell must not open the keyboard. Print controls
remain available, and the `readOnly` renderer option still selects the congregation's
announced times rather than controlling editing. Explain mode adds temporary focus and
click targets and restores their original attributes when turned off. Saved manual overrides
and rules replace the corresponding traces with explicitly
entered times, so a changed value cannot claim its old solar formula. The modal closes
before printing. `tests/time-explanations.cjs` checks actual clicks and chart geometry.
Rounding steps show the rule, the actual earlier or later movement, and the values before
and after rounding. Traces also record nearest-minute display rounding separately from
the arithmetic, while times printed with seconds retain that precision.
The separate Calculation guide was removed. Old `#calc` bookmarks open Seasonal charts;
calculation details come from clicking a time with Explain times enabled.

Admin print layouts have a **Spring clock change** switch on winter charts (also when
opening their Weekday companion). **Separate headers** gives weeks before spring DST
their own winter columns and puts the summer header below them on the same page. The
choice lives in the winter sheet's `style.splitSpringDst` and is remembered in
`settings.sheetStyle` for new print layouts. The default is one header. Only the admin's
`renderSheet` passes it into `buildSheetPages`; congregation charts keep their layout.
Both tables share one measured row height, including both headers, and the existing
shrink-to-fit loop makes room for the extra header. Keep the summer cell keys and rules
on a mixed page, including `L` for the winter section's Erev Shabbos menu, so changing
the header layout cannot move or lose a saved override. Browser coverage is in
`tests/dst-print-layout.cjs`.
Measure and shrink the full-size pages before applying Fit to screen. Measuring a
phone's zoomed preview hid the overflow and put page 5's address on page 6. Browser
coverage must start on a phone viewport and check footer placement in the actual PDF.
All charts in a print job share the same top and bottom edges for double-sided printing.
Each physical chart page explains the location stars it prints: `*בעזרת נשים` and
`**באולם השמחות`. Build this key from the rendered tables after joining DST sections,
including saved edits, rules and the weekday morning panel. Keep each star count with
its Hebrew label in a separate bidi isolate and reserve its space before fitting pages.
Omit unused locations, including the standard downstairs line on a page without an
underlined minyan time. Use the full sentence `All underlined מנינים will be בבית מדרש למטה`
and the needed star keys on one unwrapped line, separated by dots. Read the location
entries from right to left, with the full English sentence isolated in left-to-right
order and each Hebrew phrase isolated inside it. Keep each star beside its Hebrew room name and
verify actual text coordinates rather than the DOM text order. Rebuild standard
location keys from older custom footers per page and preserve unrelated notes.
The early Friday Mincha columns name their rooms in the headings: `מנחה / (בעזר"נ) /
פלג מ"א 72` and `מנחה / (למטה) / פלג מ"א`. The בעזר"נ chart times have no stars;
למטה retains its underline. Set the parenthesized room labels in chart headings to 70%
of the heading size, smaller than the Plag line. Center the three lines together using each
line's own font size, a 1.12 line height and a 0.1em gap so the printed lines stay easy
to read. Keep the room metadata used by posters, messages and the weekly reader, whose
compact schedules still use their own location marks.
`syncHeaderRowHeight` reserves the largest required header/footer regions across the job,
without changing saved styles. Collapsed table borders and the gap between DST sections
are included in row-height calculations. Measurement temporarily removes screen scaling
and the print height cap so genuine overflow stays visible to the fit loop. Refit when
fonts arrive and before printing. Browser coverage checks chart bounds, different saved
styles, and identical footer positions in the physical desktop and phone PDFs.

- A page is letter landscape: 11in x 8.5in, which is 1056 x 816 px on screen at 100%.
  All pages must measure 816px high. If they don't, something overflowed.
- **Every row in a chart is the same height, including the header row.** The header may
  be taller than the body rows when its text needs it, but never shorter. This is
  `syncHeaderRowHeight` in `js/ui/sheet-view.js` and it took several attempts to get
  right. Sub-pixel spread (under 1px) is rounding and is fine.
- Print order interleaves the two charts: שבת, its Weekday chart, שבת, its Weekday chart.
  Both are in one `#pages` container in that order, which is also what makes side-by-side
  line up pair per row.
- `Fit to screen` and `Side by side` both use CSS `zoom`, not `transform: scale`, which
  only paints smaller and leaves the original footprint. `print.css` forces
  `zoom: 1 !important` on `.pages` so neither can ever reach paper.
- Fit to screen turns itself on automatically when a page does not fit the viewport,
  which in practice means phones.
- **The שחרית panel's schedule is set in columns, one grid per row of times**
  (`js/ui/shacharis-grid.js`). Asked for: centred lines are each their own width, so no two times
  stood under each other and the slashes wandered. A paired row is five columns, time, asterisk,
  slash, time, asterisk, with **zero column gaps and the asterisk columns always there whether or
  not there is an asterisk**, which is what stops 8:20* pushing its slash past the slash above it.
  A row is its own grid, not a row of one big grid: the everyday block is set 1.3x the ר"ח one, a
  shared column is one width for both, and the smaller digits then stand off their own asterisk
  inside a column the larger block sized. Measured in the row's own em nothing has to stretch.
  `--sh-t` is one time, **measured rather than guessed**: 1.833em of ink in the boards' serif at
  both sizes, the figures being tabular (`tabular-nums`, asked for by name so it holds in a font
  where they are not the default). The column after the slash is one asterisk wider than the one
  before it and every time is set to the right of its column, which is what gives the slash the
  same air on both sides: measured 11.6 against 11.7 px in the big block and 8.9 against 9.0 in
  the small one, with every asterisk flush against its own time. Each row is padded on the left by
  one asterisk column so the slash sits at the middle of the row's box, which is what puts the two
  blocks' slashes on the same line (0.5px apart, the rest being the glyph's own ink).
  **The gap in front of a slash is the asterisk column**, whether or not that row has an asterisk
  in it, because an asterisk that takes no room is an asterisk that moves the slash on the row
  below. So the width of the mark is the width of the gap, and **the mark is set at 0.78em of the
  times**, which is the only lever there is: at the times' own size the gap measured 12.3px and the
  shul said it was too much, and at 0.78em it is 10.6px with the asterisk still clear of the digits
  (1.2px) and of the slash (2.6px). A reference mark set a little small is what a footnote does
  anyway. Tighter than that means giving up the reserved column, and then a starred row pushes its
  slash out of line with the row above, which is the thing this was built to fix.
  **An asterisk column is as wide as the widest mark in that position and no wider**, asked per
  position: two asterisks are twice the ink of one (1.0em against 0.5em, measured), so a column cut
  for one left 7:35** hanging out of its row, and cutting every column for two would push the pair
  apart to pay for a mark that is on one line of the board. Each mark carries a lead-in in front of
  it and room behind it, since an asterisk against the 0 of 8:20, or with the slash hard against
  it, is what the shul saw and said so.
  **Each row holds whatever number of times it holds**, two, three or four, so writing the schedule
  three to a line in Settings is all it takes to have it printed that way. Rows with the same count
  line up with each other; a row with more is wider and centred, the way the shul's own mock-up of
  it is.
  **The board draws the separator the schedule uses.** The shul writes "7:00 / 7:20*" on one
  version and "7:00 7:20* 7:35" on another, and a slash this code put in would be a mark on the
  paper nobody typed. A row with no slashes is also narrower on purpose: the column after a slash
  is one asterisk wider than a time needs, to give the slash equal air, and with no slash there is
  nothing to centre. Measured on the shul's own no-slash layout, that mirror was 184px a row
  against the 156px there is room for inside the panel, and 146px once it came off, so it fits with
  the panel at the width it already has. A slash at the end of a piece counts as much as one
  between two times in it: "8:20* / " then a separate `<u>8:40</u>` is how the shipped schedule
  holds its third line, and asking only about the middle left that one row slashless.
  **It reads what is in Settings rather than being told it**, since that is hand-typed rich text
  whose separators have been commas, spaces and slashes over the years. Markup it does not know and
  it hands the block back untouched to print exactly as it did before: a wall chart is not the
  place to be clever with somebody's typing. A line that is not a row of times (the ר"ח ובה"ב
  heading, the lone 8:40 that ends the block) is centred under the rows, which is where the
  hand-made boards put it.

## Hebrew and bidirectional text

This is where the sneaky bugs live.

- Display Hebrew double quotes with the straight mark used in `ס"ז קר"ש`, including
  headings, notes and Hebrew years. `useStraightHebrewQuotes` changes text nodes before
  layout measurements, preserving attributes and calculation keys.
- `.cell` and `.shacharis-merged` set `direction: ltr` deliberately. Changing that
  scrambles the time strings.
- Wrap Hebrew inside an otherwise-LTR string in `<bdi>`, or you get output like
  "28 · 5787 · שבת חורף weeks".
- **Stored character order is not display order.** The Weekday footer cost four rounds
  over where two asterisks appear. The single `*` is the last character in the stored
  string but displays at the right-hand end of the line, next to בעזרת נשים. If a
  question is "where will this character appear", render it and measure the x positions
  of the substrings. Do not reason it out and do not trust how it looks in a chat message
  or a text box.
- Fonts are self-hosted in `assets/fonts/`, because Android has none of Times New Roman,
  David, or Frank Ruehl and falls back to a sans-serif for Hebrew. `HEBREW_STAND_IN` in
  `js/ui/sheet-view.js` maps each font choice to the shipped stand-in that looks closest:
  Frank Ruhl Libre covers Times New Roman, David Libre covers David. Arial and Segoe UI
  deliberately get no webfont, since every device already has a Hebrew sans.

## Data model

Everything lives in one localStorage key, `zmanim-app-state-v1`:
`{ settings, sheets, rules, seeded }`. There is no backend and there will not be one.
Export/Import in Settings moves it between devices.

- **Per-cell overrides** are historical saved values tied to one generated sheet.
  Saved sheets and imported backups retain them, but chart cells cannot create new ones.
- **Rules** apply at generation time to every future sheet. Conditions: `always`,
  `specialParsha`, `parsha`, `dateISO`, `hebrewDate` (`"5-9"`, month-day counting Nisan
  as 1, recurs yearly). Column keys are sheet-qualified: `kayitz:C`, `choref:B`.
- One rule is **seeded** (ט באב), guarded by a flag in `state.seeded` so deleting it stays
  deleted. There were three. שבת שובה and שבת הגדול each appended the bare word דרשה, and
  both afternoons are now computed by the chart instead (`DRASHA_NAMES` and
  `shabbosMinchaMenu` in `js/sheets/common.js`): the דרשה an hour before the מנחה that is 45
  minutes before שקיעה, its מנחה למטה half an hour before that, and no 5:30 / 6:00 / 6:30.
  `isRetiredDrashaRule` in **`js/rules.js`** takes the old rules back off a browser that holds
  one, matching on what a rule does rather than the id it was seeded with, since both were
  hand-made on some browsers before they were ever seeded, and on **what it writes rather than
  which week it writes it on**: a condition can name שבת הגדול in more ways than a list can hold.
  **There are two doors, and for months only one of them was watched.** `applySeeds` in
  `js/storage.js` cleans localStorage, which is the admin; the congregation's site reads none of
  it. It reads `data/published.json`, **which carries a copy of the rules**, so the retired ones
  went on firing on the public board long after the admin was right, and the shul saw the second
  wordless דרשה on שבת הגדול on the site while the admin printed it correctly. `loadPublished` in
  `js/publish.js` now runs the same retirement off the same definition, so a file published before
  it cannot put a rule back, and the rules were taken out of the published file itself so the
  board on the site was right without anybody having to republish. Anything a published file
  carries is a snapshot of the day it was written: when a rule or a default is retired, ask
  whether that file is still saying the old thing.
- When a shipped default's wording changes, add the old value to a `LEGACY_*` list in
  `js/settings.js` and carry it forward in `normalizeSettings`. That upgrades installs
  that never edited it, while leaving anything hand-typed alone. See
  `LEGACY_FOOTER_ADDRESS` and `LEGACY_ACCENT_COLORS`.
- **The Weekday chart's two שחרית schedules and its footer note are not settings.** They are
  `WEEKDAY_SHACHARIS`, `WEEKDAY_SHACHARIS_SPECIAL` and `WEEKDAY_FOOTER_NOTE` in
  `js/settings.js`, read straight from there by the chart, the week card, the One sheet, the
  יו"כ / סוכות / פסח posters, "what is on next" and every message that names a מנין. They were
  three fields in a **Weekday chart defaults** panel in Settings and the shul asked for that
  panel gone, so **do not put it back**: the note at the top of `js/ui/settings-view.js` says
  why. Those seven times are on the wall, on the phone and in the messages that go out, and
  each of those readers has to be saying the same thing, which a field one browser can type
  over is a way to break.
  The published file proved it. `data/published.json` carried its own copy of
  `weekdayShacharis`, so **the congregation's `/chart/` page was printing the old two to a line
  slash schedule while the admin printed the three to a line one**, and nobody would have seen
  it without opening both. Same lesson as the retired rules above, and the same fix: read from
  one place, and take the stale copy out of the published file. `RETIRED_SETTINGS` in
  `js/storage.js` drops the three keys (and the two always-blank מנחה / מעריב ones) as settings
  load, so nothing carries a copy forward in a backup either. The `LEGACY_WEEKDAY_*` lists,
  `splitCombinedShacharis` and the `special840Back` seed went with them: there is no longer a
  saved value to carry forward.

## Screen layout

- `main:not(.is-sheet-view)` is capped at 62rem and left aligned against the sidebar.
  This is deliberate and was asked for twice: the point is not dragging the mouse from
  one edge of the screen to the other. **Do not centre it.** Centring was tried and
  rejected.
- `main.is-wide` (Saved sheets) gets 78rem, because a six-column table wraps at 62rem.
- A sheet view is exempt from the cap entirely; a page is a fixed 11in.
- `.gen-column` holds the Generate flow to 42rem.
- On the congregation's `/week/`, minyan times are buttons opening room details in
  English and Hebrew. The room comes from the existing agenda event: underlined means
  downstairs, one star means Ezras Nashim, two mean Simcha hall, and an unmarked minyan
  means the main Bais Medrash. Auxiliary zmanim and unmarked Kiddush Levana get no
  indoor room. Keep the hint and dialog off paper, and defer the minute redraw while
  the dialog is open. `tests/weekly-room-details.cjs` checks phone taps, keyboard access,
  all four rooms, week navigation, and native printing.
- Weekly day headings also name Rosh Chodesh (including its month), BHB, and fast days
  beside the weekday. Read these labels from the existing calendar helpers in English;
  keep section keys, grouping, and minyan calculations independent of the labels. Use
  the same labels in notices for days whose full schedule has not been supplied.
- Open donation forms get a 48rem page cap and reach the card edges on phones. Give the
  cross-origin form at least a 360px internal viewport and scale it to the available
  width, keeping the visible height and vertical scrolling. Resize the existing frame
  on rotation so entered fields survive, and disconnect its observer when it closes.
  Check actual pointer clicks inside scaled frames, every payment field and security
  checkbox, and all five card/ACH forms. Cardknox's Rav's Fund tab strip itself remains
  700px wide, but its tab labels and payment controls fit the narrower phone viewport.

## Public schedule API

`/api/schedule.json` returns only ten calendar dates: today and the following nine
days in the shared settings' timezone (`America/New_York` for this shul). It is a
read-only public JSON feed with no date/range query parameters. Serialize an explicit
allowlist of date, service, time, parsha, and occasion fields. Never include rooms,
addresses, coordinates, stars, underlines, or raw settings. Merge identical services
at the same time after discarding rooms, while retaining different zman reckonings.

`scripts/schedule-feed.mjs` adapts the same weekly reader and agenda engine as `/week/`.
Use a clock before the ten-day window when collecting events so today's already-passed
times remain. Normalize overnight events to their actual calendar date, and include
the preceding week when collecting the window's first day's overnight services.
Keep `unconfirmed` and `unavailable` dates explicit, without inventing normal schedules.

`node scripts/build-schedule-api.mjs` writes `dist/api/schedule.json` after the ordinary
Python build; the Python build clears dist first. Do not commit generated JSON or put
the API adapter/build scripts into dist. The Pages workflow runs this generator on
every deployment and daily at 04:07 and 05:07 UTC, covering both New York DST offsets.
Consumers must check the published range and timestamp because scheduled deployment
can be delayed. `node --test tests/schedule-feed.mjs` checks the ten-day limit, omitted
location fields, full-day retention, midnight/DST transitions, and special schedules.
Verify the live JSON, response CORS, and a real fetch from another origin after deploy.

## Site statistics

The statistics page and analytics Worker share one exact America/New_York date
window and snapshot. Read [worker/README.md](worker/README.md) before changing
collection, archives, metric definitions, or deployment. Missing history must never
be presented as measured zero. Deploy the compatible Worker before its frontend.

## הדלקת נרות on the congregation's home page

The "what is on next" card shows the next מנין and, beside it, that day's הדלקת נרות. It used to
read that off the chart's H column alone, which only ever has one on a **Friday with a שבת row
behind it**, so **every ערב יום טוב had no candle lighting at all**: ערב ר"ה, ערב יו"כ, ערב סוכות,
ערב שמיני עצרת, ערב פסח and ערב שביעי של פסח, plus the Friday before a שבת חול המועד. A שבת that
is yom tov has no chart row, so even the ones that fall on a Friday fell through. The shul reported
it on ערב ראש השנה, where the card named the מנין off the sheet and said nothing about candles.

- Each poster now registers its own הדלקת נרות through **`M.zman`** (`posters/minyanim.js`), a list
  kept **apart from `minyanim`**. Everything in `minyanim` is offered as "what is on next", and a
  card reading "next minyan: הדלקת נרות" would be wrong in exactly the way that file warns about.
  Registered in the builder beside the printed line, like every מנין, so the phone and the paper
  cannot come apart.
- **`specialCandleLighting` in `posters/day.js` is a separate walk from `specialMinyanim`**, and it
  reaches further: the **פסח sheet is in it**. `specialMinyanim` is deliberately only the תשרי
  stretch, because that is where a sheet takes a whole day over from the charts, and widening it
  would change what the home page calls the next מנין across all of פסח. Reading one number off the
  פסח sheet changes nothing else.
- `candleLightingForDay` asks the sheet **before** the chart, because the two overlap on the
  Shabbosos the סוכות and פסח sheets carry, and there the sheet is what is hanging on the wall.
- Measured over three years: all eighteen erev yom tov candle times match the printed sheet to the
  minute, and over a year of days 29 Fridays still come off the chart and 7 off a sheet.

## The messages page, `/texts/`

The chat messages the shul sends out, on a page of their own. **A third entry page beside
`index.html` and `admin/index.html`**, with its own entry module (`js/texts-app.js`) and its
own view (`js/ui/texts-view.js`), stamped by `build-offline.py` exactly the way the admin is
and listed in `DIST_TREES`.

- **It carries no link of any kind**, no sidebar, nothing back to the admin or out to the
  congregation's site. That is the whole point: the person who sends the weekly message is not
  the person who prints the boards, so the address is handed to them on its own. A browser test
  asserts there are zero `<a>` elements on it. Do not "helpfully" add a back link.
- The admin's sidebar gets a **Messages** entry, and it is an `<a href="/texts/">` rather than
  a tab, because it leaves the page. Beside it is **Congregation site**, `<a href="/">`, asked for:
  there was no door from the admin to the congregation's own page at all and the only way across
  was typing the address. The congregation's site does not get a matching link back and should not,
  being the page the whole neighbourhood opens. The browser's own back is the way home from either.
  `renderNav` binds its click handler on `button.nav-btn` rather than `.nav-btn`: the two links
  carry the class to be drawn the same, and on the class alone the handler set the current tab to
  nothing and redrew the page underneath a navigation that was already happening. It only ever
  looked fine because the browser won the race.
- **No PIN, and that is a decision rather than an oversight.** The admin asks for four digits
  because somebody wandering in there can change the shul's boards. This page changes nothing
  and prints messages that are about to be sent to the whole congregation anyway, so a gate
  would only mean handing the admin's PIN to the one person it was built for. Do not add one.
- **No message computes a time, and no message keeps its own copy of one.** Said by the shul as
  "none of the announcements should work based on new calculations, everything has to work with the
  charts", after two of these got through: a `(Mariv ...)` on ערב שביעי של פסח worked out as the
  printed פלג plus ten, and a hand-written ROSH CHODESH schedule carrying a מנין the chart has not
  got. Both are gone. Every figure on this page is read off a board or a sheet, and a line those
  have not got is **left out** rather than invented: a number this code makes up is one the paper
  cannot check and nobody would think to question. `erev-text.js` reads the chart row for ערב שבת,
  `erev-yomtov-text.js` reads the built poster for the yom tov ones, `rosh-chodesh-text.js` reads
  the chart's ר"ח schedule. Dates and weekdays are not times: working out which month ראש חודש is,
  or whether a day of yom tov is a Friday, is the calendar and is fine.
- **The room letter has one definition**, `erevWhereMark` in `erev-text.js`: underlined is `d`, one
  star `en`, two `sh`, unmarked `m`. The yom tov messages read poster times and the others read
  chart cells, and both carry the mark the same way, so the letter must not be worked out twice.
  The day the two disagreed would be the day a message sent somebody to the wrong room.
  `erevTimes` keeps the stars that follow a time for exactly this.
- **The weeks are computed, not looked up** (`txWeekNow`). This page must never need somebody to
  have generated a chart first: the chart is where these times are printed, not where they come
  from. Four candidate seasons are built and whichever contains this week wins, which is brute
  force and cannot be subtly wrong the way a branch on the date can. A saved chart still wins
  where one covers the week, so a hand-edited cell reaches the message.
- **`TX_AHEAD_DAYS` is 4**, asked for: whatever is applicable within four days is on the page and
  nothing else is. Without a window the yom tov cards sit there for eleven months.
- The message box is a **textarea and editable**, because whoever sends these wanted to add a
  line first. Copy takes what is in the box, not what was built into it. Edits do not persist:
  a reload rebuilds from the calendar, which is the way round that cannot leave a stale time in
  a fresh message.
- `d` and `m` mean בית מדרש למטה and the main בית מדרש, from whether the time is underlined on
  the board. `en` is the עזרת נשים column. Times that are not מנינים (חצות, הדלקת נרות) carry
  no letter.
- **A שבת that is yom tov gets no Erev Shabbos message and Shabbos is not mentioned.** Asked and
  answered: on a year where ערב ר"ה is a Friday, the shul sends the ערב ראש השנה message and says
  nothing about שבת. The window does this on its own, since such a Shabbos is not a chart row, but
  do not "fix" it by folding Shabbos times into the yom tov message.
- **Finished is finished in both views.** `txDaysInWindow` relaxes only its four day half for the
  year view, never the "still to come, or still running" half. Showing everything means everything
  ahead, not everything ever: letting a past occasion through opened the page on last פסח's שביעי
  message, sorted to the top because it was the earliest date on the screen. The shul saw it.
- **The תשרי year is held until שמחת תורה, not until ראש השנה** (`txTishreiYear`). Turning it over
  when the ראש השנה sheet finished meant that from the day after ראש השנה, ערב יום כיפור, ערב סוכות,
  ערב שמיני עצרת and the יום כיפור ותיקין announcement were all asked of next year and so **never
  appeared at all**. Found by walking a year of dates a day at a time and printing what each day's
  page held, which is the only way a hole like that shows: every day looked fine on its own, it just
  had nothing on it. Worth re-running that sweep after any change to a window here.
- **A yom tov card is windowed on its own days, not on its sheet's span**, wherever the two differ.
  The סוכות sheet speaks past שמחת תורה and the פסח sheet to the last day, so both would otherwise
  leave an "Erev" card up through חול המועד. ערב שביעי של פסח covers the far end of פסח.
- **Every card shows the day the message goes out**, weekday and full date, in the device's own
  locale (`txDateLabel`, UTC parts throughout, since a serial is a whole day and a local midnight
  lands on the day before west of Greenwich). Asked for after the stale-card bug above: a message
  is only times, so one carrying last year's looked exactly like one carrying this year's.
- **ROSH CHODESH** (`js/rosh-chodesh-text.js`) reads its שחרית off the wall chart, from
  `WEEKDAY_SHACHARIS_SPECIAL`, the second schedule the chart prints on a ר"ח, a בה"ב and a
  תענית. The letters come off that cell's own marks (`erevWhereMark`), so editing the schedule in
  Settings moves the message with it. No times of its own: it broke that rule twice and the shul
  caught both.
  It carried a hand-written copy of the schedule, and the copy had a **6:50 בעזרת נשים the chart has
  not got**, so the message announced a מנין the board does not show. And it carried the
  `(T"T 7:25)` every one of the seventeen sent messages has, which is on no chart at all, so nothing
  here knows how that time is arrived at or what would move it.
  What it does work out is the calendar, not the clock: the month, and the day ראש חודש starts on,
  which is the thirtieth of the month before wherever that month has one. **תשרי is skipped**, its
  ראש חודש being ראש השנה, which has its own message. אב is written "Menachem Av" and חשון
  "Mar Cheshvon" (`RC_TEXT.spelling`); `JEWISH_MONTHS_EN` keeps saying Av and Cheshvan for the
  charts. Where the chart has no second schedule the card is dropped rather than sent as a heading
  with no times under it.
  One thing deliberately not built: three of the seventeen, in חשון, טבת and שבט, open
  "6:50m&ns, [Netz 7:15]" instead, where the bracket is sunrise and the מנין is sunrise less twenty
  five minutes. Neither number is on a chart, so neither is built.
- **The year view has five switches under "Include in messages", Erev Shabbos, Weekday, Yom Tov,
  Taanis and Rosh Chodesh**, and everything on it is in **date order**, which is the order these get
  sent in. All on to begin with, and turning them all off says so rather than looking broken.
  The weekly message is its own switch rather than part of Erev Shabbos, asked for: they are the
  week's schedule and Friday's, they are checked for different things, and fifty of each on one
  screen is a hundred cards. Same for the fast, which is not a yom tov.
  They are **`switchHtml` from `js/ui/switch.js`**, the same control This week and the Posters bar
  use, rather than a third kind of control invented for this page. Each kind is its own question
  with a yes and a no, which is what these are: five things that can each be on or off, not one
  choice between five. **Do not wrap each one in a row of its own**: `switchHtml` hands the
  question and the track back as siblings so that a stack of them shares one grid and every track
  lines up under the last, and a wrapper makes each its own cell and loses that. Measured: all
  five tracks start at the same x, at 900px and at 375px.
  The four day window has no switches: it is a handful of cards and filtering that would be five
  controls over almost nothing. Each message carries the serial of the day it goes out, the ערב
  rather than the day itself, which is what the sort runs on.
- **ערב שמיני עצרת reads the שמיני עצרת block, not the sheet's first**, since that evening is
  הושענא רבה's, five blocks in, and every block before it carries the same three calcs (`ytBlock`).
  Its sent message carries **no sign-off**, where every other one ends on a fixed line, and that is
  written the way it was sent. Its afternoon is the sheet's and **the sheet disagrees with the
  message that was sent**: the shul asked for the whole run to be למטה (the main בית מדרש is being
  set up for the night), and the October 2025 message says 1:50m, 2:15m, 3:00m, which is the old
  arrangement. The sheet is what gets hung, so the sheet is what the message reads. If the shul says
  otherwise the fix belongs in `sukkosErevMincha` and both move together.
- **Triple click the heading** to drop the window and show every message the year holds, about
  fifty of them, and again to put it back. For checking, not for sending: nothing is stored and a
  reload is back to the four days. It listens on the heading rather than the page so that triple
  clicking a message to select it does not turn the year on.
- **The shul's SMS history is the spec.** Fourteen real erev yom tov messages, May 2025 to
  September 2026, and they are one skeleton: title, optional Selichos / Chatzos / סוף זמן lines,
  the Mincha menu, an optional `ERUV TAVSHILIN`, Hadlakas Neiros, an evening Mincha (כל נדרי on
  יו"כ), an optional Ravs Drasha, then a sign-off that is fixed words per yom tov. Build a new one
  off a real sent message, not off a guess.
- **`ERUV TAVSHILIN` is read off the sheet's own heading**, not worked out again. The סוכות, פסח
  and ראש השנה sheets print the note over the day it is made for, so the message asks the heading
  (`ytEruv(block, word)`). Asking the calendar a second time got the right answer from the wrong
  place: the paper and the message could have disagreed and neither would have known.
  **The rule is that any day of yom tov is a Friday**, first or last, said by the shul in those
  words after this was first written as "the last day", which is the same answer for a yom tov
  running Thursday into Friday and the wrong one for one running Friday into Shabbos.
  **Asking the sheets put two real holes in the printed paper right.** They tested the day after
  the last day, so **שביעי של פסח printed no note in תשפ"ט, תשצ"ב, תשצ"ו and תשצ"ט**, the years
  פסח opens on Shabbos and שביעי is therefore the Friday. And the **ראש השנה sheet had never
  printed one at all**, though its יום ב' is a Friday in תשפ"ה, תשפ"ט, תשצ"ב, תשצ"ה, תשצ"ו, תשצ"ח
  and תשצ"ט. Both are fixed in the builders (`eiruvOn` in each), which is where it belongs: the
  note is on the paper the shul hangs as well as in the message.
  1 תשרי, 15 ניסן and 15 תשרי can never be a Friday, so the first days always turn on the second
  day; the test is written the general way regardless, so the next reader is not left working out
  which of the two rules a given line is.
  In סוכות, `day2Friday` is a **different question** that used to be an alias of the עירוב one:
  whether יום ב' itself runs into Shabbos, which decides that its afternoon belongs to both days.
  The two agree only because 15 תשרי is never a Friday. Asked on its own now.
  Measured across תשפ"ה to תש"ף: sheet, message and the rule agree on every occasion of every year.
  The poster stays 816x1056 with nothing overflowing, checked with the longest heading the new rule
  can produce.
- **The room letters are the sheet's marks**: underlined is `d`, one star is `en`, two stars is
  `sh`, unmarked is `m`. Confirmed against the shul's ערב יום כיפור message, which is
  `YK_TEXT.erevShacharis` mark for mark. The sent ערב סוכות message leaves the letter off its
  evening מנחה where every other sent message carries one, and this writes the letter: one
  character, and it is the one that makes every message on the page say the room the same way.
- **ערב שביעי של פסח has the shape of an Erev Shabbos message**, not of the other yom tov ones,
  and its title says so: "Erev P' Shevii Shel Pesach". חול המועד is a weekday, so that evening
  carries the three early מנחה and פלג מנינים a Friday carries, and the sheet prints them for that
  reason. `ytEarlyLines` writes them with the same wording `erevShabbosText` uses, naming each פלג
  off the room its מנין is in: עזרת נשים is פלג מ"א 72 and takes a bare "Plag" with no comma,
  למטה is מ"א, the main בית מדרש is גר"א.
  **The three "(Mariv ...)" the sent message has are not built.** An ערב יום טוב has a מעריב after
  each early מנחה where an ערב שבת cannot, and the sent message puts all three exactly ten minutes
  after their פלג. This worked them out from the printed פלג for a while and should not have: they
  are on no board and no sheet, so there is nothing to read them off. If those מנינים are real they
  belong on the פסח sheet, and then the message reads them off it like everything else.
  **That sent message and the sheet disagree by a day**, measured: its 5:51/6:06, 6:27/6:42 and
  6:47/7:02 are 6 April 2026's פלג times exactly, while ערב שביעי was the 7th, whose are
  5:52/6:07, 6:28/6:43 and 6:48/7:03. Its own הדלקת נרות, 7:09, is the 7th's (the 6th is 7:08), so
  the message mixes two days and the candle line is the one that is right. The sheet is kept.
- Built so far: ערב ראש השנה, ערב יום כיפור, ערב סוכות, ערב שמיני עצרת, ערב פסח,
  ערב שביעי של פסח, and the two ותיקין announcements. Each is measured against the shul's own sent message before it is called done,
  line for line. A sheet that carries the same `calc` on several nights (פסח and סוכות both open
  every night of yom tov with a הדלקת נרות) is read with `ytFirst`, which takes the first, since
  the ערב block prints before the day blocks.
- **The weekly message** (`js/week-text.js`) is the one that goes out on a Sunday for the week
  ahead, "Week of P' Ki Seitzei", and it is **the Weekday chart's three columns**: שחרית off
  `WEEKDAY_SHACHARIS`, which is what the chart prints as its own merged cell, then the chart's
  מנחה column C and מעריב column B. Overrides from a saved Weekday chart are laid over where one covers the week,
  so a cell corrected by hand reaches the message; most weeks have none, since this page computes
  its weeks. `mergeRow` throws on a null sheet, so the merge is guarded rather than always run.
  **Its weeks are the Weekday chart's own list** (`computeWeekdayWeeks`), not the Shabbos charts'.
  That is the difference between a week having a message and not: a week whose Shabbos is yom tov
  has no parsha and so is no row on a Shabbos chart, while its Sunday through Thursday are ordinary
  days the shul davens and the Weekday chart prints. Read off the Shabbos list, **the week of
  סוכות, of פסח, of שבועות and of ראש השנה had no message at all**, which the shul reported. Those
  weeks are named for the yom tov in them, the way the chart's own row is: "Week of Sukkos", and
  the "P'" goes in front of a parsha only.
  A full Chanuka week keeps the parsha: "Week of P' Miketz - Chanuka". Erev Shabbos messages
  add " - Chanuka" when Shabbos itself is during Chanuka, including before its first night.
  Both the upcoming and full-year views use that calendar rule.
  **The morning is not always the everyday שחרית**, and the shul asked why the message still said
  it was. Through the סליחות season the shul opens earlier and on the סליחות sheet's own lists, so
  `wkMornings` asks `weekdayMornings` in `posters/day.js`, which is the same question the week card
  and the week's One sheet ask: one line per schedule naming its days, and the everyday line under
  them only where some morning is still running it. Three views, one answer.
  Its window is its own: it goes up on the **Friday before** and comes down after the **Thursday**,
  asked for, since from the Friday the Erev Shabbos message is the one being sent. The two ends
  meet, so there is exactly one weekly message on the page on any day: measured over 400 days, 391
  with exactly one, 9 with none (the weeks inside סוכות and פסח, which have no weekday row at all)
  and 2 with two, where the short run-up week before פסח starts before the week in front of it ends.
  Three things the sent messages have that no chart does, and which are therefore not built: a
  **7:10 and an 8:10 בעזרת נשים** in the שחרית, and a **T"T beside the 10:20 מעריב**. Same answer as
  the ROSH CHODESH line's own T"T and its 6:50 בעזרת נשים.
  Measured against the shul's own sent messages: the week of ראש השנה תשפ"ז is their Selichos line
  time for time, 6:35 on the two קריאת התורה mornings and 6:40 on the rest, which is what their
  "6:40(m&t6:35)" says; the week of שבועות is their שחרית time for time. Where a מנחה or מעריב
  differs from what they sent (6:55 against their 7:00 that week), the chart is what is kept.
- **The fast day messages** (`js/taanis-text.js`). **צום גדליה is the only fast with a sheet and
  the only one with all three lines**: `posters/tzomgedalia.js` carries שחרית, מנחה and מעריב, so
  the message is the sheet's own. The other three public fasts carry **the morning and nothing
  else**, which is the ר"ח / בה"ב / תענית list out of Settings, the second schedule the wall chart
  prints, and their sent messages carry it time for time. Their מנחה and מעריב are on no board: a
  fast afternoon is not the everyday one (the sent תענית אסתר runs 4:45, 5:10 and 5:15 after the
  chart's own list ends) and מעריב is at the end of the fast, so those two lines are left out rather
  than invented and whoever sends it adds them in the box. The page carried צום גדליה alone at
  first, for fear a message missing two lines is worse than none; **the shul asked for the rest**, a
  switch called Taanis over one message a year being a switch over nothing. When a fast gets a sheet
  of its own, its message reads the other two lines off it the way צום גדליה does.
  **יום כפור and תשעה באב are not there**: neither runs that schedule and the calendar leaves them
  out of the same list for the same reason (`specialDaysInWeek`).
  **The morning is called what the sheet calls it, סליחות**, asked for: the congregation's own
  "what is on next" card reads that same block and says סליחות, and the board, the phone and the
  message have to say one word. The label is read off the block's heading rather than typed into
  the message, and the two names that block can carry are spelled in English there. This is the one
  place the message does not follow the three sent ones, which say "Shacharis": those are for the
  three fasts with no sheet.
  **שקיעה is on it, asked for on every fast message**, between מנחה and מעריב where the sheet sets
  it, and it is the one line here that none of the three sent fast messages carries. Read off the
  sheet's own note rather than worked out again, and written without a room letter, for the reason
  חצות and הדלקת נרות carry none: a letter says which בית מדרש a מנין is in, and a זמן is not one.
  "Shkia" is the shul's own English for it, from their Shabbos message of 1 August 2025.
- **שבועות has no computed sheet**, so its message cannot be built yet. The shul is building that
  schedule, and the Rav's drasha will be on it, so the message reads it off there like every other
  line rather than carrying a time of its own.
- The shul is feeding these over time as they send them. Each new one is a builder plus an
  entry in `renderTexts`.

## The PIN on the admin

`/admin/` asks for four digits before it draws anything, remembered on that device for three
days in `zmanim-admin-unlock`. See `js/ui/lock.js`, which also says what it is worth: it
turns away somebody who guessed the address, and it is not security, because the check runs
in the reader's browser. The PIN itself is not in the source, only a salted SHA-256 of it.

**Any browser test of the admin has to set that key**, next to the app state and before the
reload, or the tab never renders and a check comes back empty rather than failing:

```js
localStorage.setItem('zmanim-admin-unlock', JSON.stringify({ at: Date.now() }));
```

It is off where `crypto.subtle` is not there to check an answer with, which is the offline
copy on `file://` and an admin served over plain http.

**The PIN is not a secret and the shul knows it.** The number is in the message of an
orphaned commit (`3da0493`), which GitHub keeps reachable by SHA forever, and in any case a
salted SHA-256 of four digits is ten thousand guesses: the whole space was searched against
the shipped hash in 0.004 seconds. This was put to the shul with both facts and the answer
was that it does not really have to be hidden. So do not raise it again, and do not quietly
"harden" it. Behind it is one browser's own localStorage and nothing else.

## Verify before you call it done

Generate a sheet and check: all pages 816px, rows equal within a page, interleaved order,
the דרשה afternoon built (מצורע/הגדול in a חורף sheet and האזינו/שובה in a קיץ one both
read as three lines: times, then a דרשה line, then times), no console errors,
no horizontal overflow at 375px on every screen, and the live hash matches after deploy.

If you touched the congregation site's routing, also check `/week/`, `/chart/` and
`/donate/` load directly, the old `/#week` style links still land, back and forward work,
and every page still reads with JavaScript off. And remember that the three-tap unlock is
in memory: it survives tapping the links, which stay in one document, and is meant to be
lost on a reload. A test that navigates with `page.goto` between pages reloads and will
see the lock back on.

## Two things to know about the user

They test on an Android phone as well as a desktop, so mobile is not an afterthought.
And they are direct: if they say a fix did not work, believe them and go measure, rather
than re-explaining why it should have.
