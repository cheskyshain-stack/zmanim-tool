# Working on this project

Printable zmanim boards for קהל לב מנחם (Bais Medrash Lakewood Commons, 44 Coles Way,
Lakewood NJ). Three charts: שבת קיץ, שבת חורף, and a Weekday chart. Ported 1:1 from
`../Lakewood Commons Zmanim tables.xlsx`, which is NOT in this repo but is the source of
truth for every calculation. If a number looks wrong, the workbook decides, not a zmanim
library.

Live at https://lczmanim.cjaffa.com (GitHub Pages from `main`, CNAME in the repo).
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
2. `python build-offline.py` (always, even for CSS only, see below).
3. Serve and test locally on a **fresh, unused port**: `python -m http.server 8907`.
   Reusing a port you served from earlier in the session gets you a cached page and a
   false pass.
4. `git add -A && git commit && git pull origin main --no-edit && git push origin main`
5. Poll the live site until the change is actually there. The workflow builds and then
   deploys, so give it about two minutes:
   `curl -s "https://lczmanim.cjaffa.com/?b=$(date +%s)" | grep -o 'app.css?v=[0-9a-f]*'`
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
  wrote is taken out, so turning analytics off is emptying that line. The congregation's page
  only: `/admin/` is a different file and the offline copy is built out of `/admin`, so a USB
  stick carries nothing that would try to phone home.
  It is a loader rather than the beacon's own tag because two of the three answers to "who is
  being counted" have to be given before the request goes out. It asks for the beacon only when
  `location.hostname` is `SITE_URL`'s own host, so a local `python -m http.server` and any
  preview count nothing, and only when this browser has not asked to be left out. **Opening the
  live site once with `?count=off` marks that device and it stops being counted; `?count=on`
  undoes it.** The mark is `zmanim-nocount` in localStorage, per device and per browser like the
  admin's unlock, and it is lost when site data is cleared. A browser that refuses localStorage
  is counted rather than broken.
  Measure this the way it was measured the first time, since the beacon is not reachable from a
  container: run Chromium with `--host-resolver-rules=MAP lczmanim.cjaffa.com 127.0.0.1:<port>`
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

- A page is letter landscape: 11in x 8.5in, which is 1056 x 817 px on screen at 100%.
  All pages must measure 817px high. If they don't, something overflowed.
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

## Hebrew and bidirectional text

This is where the sneaky bugs live.

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

- **Per-cell overrides** are one-off, tied to one generated sheet.
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
  `LEGACY_WEEKDAY_SHACHARIS` and `LEGACY_WEEKDAY_FOOTER`.

## Screen layout

- `main:not(.is-sheet-view)` is capped at 62rem and left aligned against the sidebar.
  This is deliberate and was asked for twice: the point is not dragging the mouse from
  one edge of the screen to the other. **Do not centre it.** Centring was tried and
  rejected.
- `main.is-wide` (Saved sheets) gets 78rem, because a six-column table wraps at 62rem.
- A sheet view is exempt from the cap entirely; a page is a fixed 11in.
- `.gen-column` holds the Generate flow to 42rem.

## Traffic, and the one thing in this project that is not a browser

The admin's **Traffic** tab shows the congregation site's visitor numbers. They are counted by
the Cloudflare beacon the congregation's pages carry (`ANALYTICS_TOKEN`, above) and read back
through **`worker/traffic-worker.js`**, a Cloudflare Worker in the shul's own account.

The Worker exists for one reason: reading the numbers needs a Cloudflare **API token**, and a
token cannot live in the admin. `/admin/` is a public address, the four digits in front of it
are not security, and this repository is public, so anything the page carries is published.
The token is a Worker secret instead, and the admin asks the Worker.

- Deploying it is written at the top of `worker/traffic-worker.js`, and it is now **one**
  setting: `CF_API_TOKEN`, a read-only Account Analytics token, as a Secret. It was three. The
  account id and the site tag are both looked up and cached by the Worker. `CF_SITE_TAG` and
  `CF_ACCOUNT_ID` still override, and `CF_ACCOUNT_ID`
  has to be set by hand in two cases, both of which the Worker names on the screen rather than
  guessing: a token that can see more than one account, and a token `/accounts` hands back
  nothing for. The value is the 32 characters after `dash.cloudflare.com/` in the dashboard
  address, and it is not a secret.
- **A Web Analytics site has a token and a tag and they are different strings.** The token is
  what goes in the page (`data-cf-beacon`, and `ANALYTICS_TOKEN` here); the tag is what the
  GraphQL dataset filters on. Assuming they were one string cost a day: the query ran, matched
  nothing, and the admin said "no visits counted in this period yet" while the dashboard showed
  50 page views the same day. `siteTagFor` tries to get the tag properly, by listing the
  account's sites and taking it off the one whose `site_token` is the beacon token, but **on the
  shul's own Worker that listing is refused**: the read-only Account Analytics token queries the
  analytics data fine and gets "Authentication error" from that REST endpoint, which is a
  different permission. So in practice the query narrows by **`requestHost`** instead, which is
  the same site said another way and is what is actually running. The reply says which of the two
  it used and the empty state prints it, because an answer of zero and a wrong question look
  identical. Measured once it worked: 23 visits and 51 page views, matching the dashboard.
- **Cloudflare counts days in UTC, and this shul is not in UTC.** From about 8pm in Lakewood the
  UTC day has already turned over, which put a bar labelled tomorrow on the chart at 9:40 at
  night and, far worse, filed every evening visit under the next day: Friday night counted as
  Shabbos. The per-day chart and the weekday panel are therefore rebuilt in the browser out of
  the **hourly** buckets, which are real instants (`trafficLocalDays`), and the tab asks the
  Worker for one day more than it shows so the oldest local day is whole. Both figures sum across
  that fold: a page view is one event and a visit belongs to exactly one hour. Where the hourly
  grouping does not reach back over the whole period it falls back to the UTC days and says so on
  screen. Do not "simplify" this back to `byDay`.
- **The days drawn are the calendar's, not the ones that have traffic in them.** `trafficLocalDays`
  used to take the last N hourly buckets that had rows, which is two wrong answers at once. A quiet
  day vanished rather than being drawn empty. And the newest bucket with rows is not today: before
  the first visit of the morning it is yesterday, so the screen put **yesterday's whole day under a
  button marked Today**. Worse, Cloudflare's hourly detail was reaching back only about a day, so
  every range, Today and 7 days and 30 days alike, was adding up that one day: **30 days read lower
  than Today**, which is an impossible number rather than a stale one. The shul reported both. The
  days now come from the calendar and the hourly rows are used only where they actually cover the
  period asked for (`TRAFFIC_HOUR_SLACK_MS`, one day of slack for a quiet morning at the start).
- **Any one day can be opened on its own, and then every panel is that day's.** Asked for: the
  panels are Cloudflare aggregates over the window the Worker was asked about, so over a range they
  describe the range, and there was no way to ask what was opened on a Tuesday. The browser now
  works out the two instants that bound one day **on the reader's own clock** and sends them as
  `since` and `until`; the Worker answers about exactly that window, so the pages, devices, hours,
  referrers, browser and system are the day's own. Reached two ways: a date field beside the range
  buttons, and **every bar of the day chart is a real `<button>` that opens its own day**.
  `trafficDayWindow` builds the window with `new Date(y, m - 1, d + 1)` rather than by adding
  86400000, so the day a clock changes is one whole day rather than 23 or 25 hours of one and an
  hour of its neighbour. The timezone is the reason this is worked out in the browser at all: the
  Worker does not know where its reader is standing.
- **The Worker has to be deployed again for the day view to work**, and an older one fails in the
  one way that looks like success: it ignores `since` and `until` and answers about its own range,
  which would put a week's pages under one day's date. So the Worker returns `window: 'exact'` when
  it honoured the two instants, and the tab refuses to draw a day without it, saying the copy
  running is older instead. `askedWindow` in the Worker refuses a window it cannot parse, one the
  wrong way round, or one longer than `MAX_WINDOW_DAYS` (40), rather than answering about some
  other stretch of time.
- Over a **range**, the panels are still the whole window Cloudflare was asked about, which starts
  at midnight UTC and takes in one extra day, so they reach a few hours further back than the chart.
  Only the two headline figures and the chart are on a Lakewood clock, and the foot of the tab says
  so. Over a **day** there is nothing to fold or trim and the foot says that instead.
- Cloudflare keeps about a month, so a day older than that reads as nothing unless the Worker's
  archive was running by then. The empty state for a day says so, and says when the archive is off.
- **Cloudflare keeps about a month, so the Worker keeps the shul's own copy.** An optional KV
  namespace bound as `ARCHIVE` holds one entry: UTC date to two arrays of 24 hours (visits and
  page views), plus that day's pages, devices, systems and referrers. Hours rather than day
  totals, because the screen folds them into Lakewood days and that fold needs the hour. Nothing
  is asked of Cloudflare past `LIVE_DAYS` (30), because past that it answers zero rather than
  answering no, and a live zero written over a real figure turns a missing answer into a wrong
  one. Cloudflare wins for the days it still has, so a day stored while it was still filling in
  gets corrected rather than frozen. A daily Cron Trigger folds in yesterday and the day before,
  one whole UTC day at a time, so the record has no holes in the stretches nobody was looking.
  **The binding and the cron are both optional and the Worker deploys and runs without either**,
  saying on screen which it is. Two writers can race and the loser's day is dropped; it comes
  back on the next write while Cloudflare still holds the month.
- The Worker's address goes in `TRAFFIC_API` in `js/ui/traffic-view.js`. **While that is empty
  the tab is the deploying instructions**, not an error.
- `worker/` is not in `DIST_TREES`, so it is not copied into `dist/`. It holds no secret
  either way.
- The endpoint is open, and that is a decision rather than an oversight: CORS is a rule only
  browsers keep, and a key in the admin page would be as public as the page. What it hands out
  is aggregate visit counts for one shul's zmanim. Closing it properly means Cloudflare Access
  in front of the Worker.
- The tab shows Cloudflare's own error text verbatim when something is wrong. The shape of the
  analytics schema is the one thing here that cannot be checked from this repository, so the
  useful thing on the screen is exactly what Cloudflare said.
- Test the screen by pointing `TRAFFIC_API` at a made-up address and fulfilling the request in
  Playwright with `page.route`. Four states are worth covering: not set up, numbers, nobody has
  visited yet, and the Worker refusing.

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
  `settings.weekdayShacharisSpecial`, the second schedule the chart prints on a ר"ח, a בה"ב and a
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
  ahead, "Week of P' Ki Seitzei", and it is **the Weekday chart's three columns**: שחרית out of
  Settings, which is what the chart prints as its own merged cell, then the chart's מנחה column C
  and מעריב column B. Overrides from a saved Weekday chart are laid over where one covers the week,
  so a cell corrected by hand reaches the message; most weeks have none, since this page computes
  its weeks. `mergeRow` throws on a null sheet, so the merge is guarded rather than always run.
  **Its weeks are the Weekday chart's own list** (`computeWeekdayWeeks`), not the Shabbos charts'.
  That is the difference between a week having a message and not: a week whose Shabbos is yom tov
  has no parsha and so is no row on a Shabbos chart, while its Sunday through Thursday are ordinary
  days the shul davens and the Weekday chart prints. Read off the Shabbos list, **the week of
  סוכות, of פסח, of שבועות and of ראש השנה had no message at all**, which the shul reported. Those
  weeks are named for the yom tov in them, the way the chart's own row is: "Week of Sukkos", and
  the "P'" goes in front of a parsha only.
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
- **The fast day message** (`js/taanis-text.js`) is **צום גדליה only, and that is the whole of what
  the boards can answer**. Its sheet (`posters/tzomgedalia.js`) carries all three schedules, so the
  message is the sheet's own שחרית, מנחה and מעריב with the sign-off the sent ones end on. The other
  three public fasts have no sheet: their morning is the ר"ח / בה"ב / תענית list out of Settings,
  but a fast afternoon is not the everyday one (the sent תענית אסתר runs 4:45, 5:10 and 5:15 after
  the chart's own list ends) and מעריב is at the end of the fast. A message missing two of its three
  lines, or carrying times this program made up, are both worse than no message. When the shul hangs
  a sheet for one of the others, its message reads off that sheet the way this one does.
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

Generate a sheet and check: all pages 817px, rows equal within a page, interleaved order,
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
