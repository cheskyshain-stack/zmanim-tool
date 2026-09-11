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
  `isRetiredDrashaRule` in `js/storage.js` takes the old rules back off a browser that holds
  one, matching on what a rule does rather than the id it was seeded with, since both were
  hand-made on some browsers before they were ever seeded.
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
- The panels under the chart (pages, device, hours, referrers, browser, system) are Cloudflare's own
  aggregates over the window the Worker was asked about, which starts at midnight UTC and takes in
  one extra day, so they reach a few hours further back than the chart. Only the two headline
  figures and the chart are on a Lakewood clock. The foot of the tab says so. Narrowing the panels
  properly means the browser sending the Worker explicit instants rather than a day count.
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
  a tab, because it leaves the page.
- **No PIN, and that is a decision rather than an oversight.** The admin asks for four digits
  because somebody wandering in there can change the shul's boards. This page changes nothing
  and prints messages that are about to be sent to the whole congregation anyway, so a gate
  would only mean handing the admin's PIN to the one person it was built for. Do not add one.
- Every message is **read off the same sheet the times are printed from**, never recomputed
  beside it: `erev-text.js` for ערב שבת (off the chart row) and `erev-yomtov-text.js` for the
  yom tov ones (off the built poster). A message with a time nobody printed is the failure to
  avoid, so a line the sheet has not got is left out rather than guessed at.
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
- **ROSH CHODESH** (`js/rosh-chodesh-text.js`) is the one message here with **no זמן in it at all**:
  every time is an announced מנין, the same list month after month, so there is no sheet behind it
  and nothing for it to disagree with. What it does read off the calendar is the part that can be
  got wrong, the month and the day it starts on, which is the thirtieth of the month before wherever
  that month has one. **תשרי is skipped**, its ראש חודש being ראש השנה, which has its own message.
  אב is written "Menachem Av" and חשון "Mar Cheshvon" (`RC_TEXT.spelling`), which is how the shul
  writes them; `JEWISH_MONTHS_EN` keeps saying Av and Cheshvan for the charts.
  **The `(T"T 7:25)` every one of the seventeen carries is deliberately left out**, on the shul's
  instruction: it is not on any chart here, so nothing in this program knows how that time is
  arrived at or what would move it. Every other time on the line is a מנין announced at a fixed
  hour, which can be repeated without knowing anything; a time whose reckoning is unknown cannot be
  kept right, and a line that is right until the year it quietly is not is worse than one that was
  never there. The sender can type it back in. If the T"T ever reaches a chart it belongs here read
  off that.
  Two other things the seventeen show that are deliberately not built: the list is not quite
  fixed (6:50ns missing from four, 8:10ns on three), and three of them, in חשון, טבת and שבט, open
  "6:50m&ns, [Netz 7:15]" instead, where the bracket is real sunrise and the מנין is sunrise less
  twenty five minutes. That looks like a winter rule and is not one, since כסלו in the middle of
  that stretch uses the ordinary form. Three examples cannot say which months take it.
- **The year view has three buttons, Parsha, Yom Tov and Rosh Chodesh**, and everything on it is in **date order**,
  which is the order these get sent in. Independent toggles, both on to begin with, so the pair
  reads as what is showing rather than as a choice between them; turning them all off says so. The
  four day window has no buttons: it is a handful of cards and filtering that would be two buttons over
  almost nothing. Each message carries the serial of the day it goes out, the ערב rather than the
  day itself, which is what the sort runs on.
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
- **`ERUV TAVSHILIN` goes in when ANY day of yom tov is a Friday**, first day or second, between
  the Mincha menu and Hadlakas Neiros, in capitals on its own line. Said by the shul in those
  words after this was first written as "the last day", which is the same answer for a yom tov
  running Thursday into Friday and the wrong one for a yom tov running Friday into Shabbos.
  Asked of the date rather than the name: two sent messages make it look like a פסח and שבועות
  thing, but ראש השנה falls Thursday and Friday often enough (5789, 5792, 5795, 5796, 5798, 5799
  in the next fifteen). יום כיפור never falls on a Friday, so it never asks.
  **The days are handed to `ytEruv`, never taken off a sheet's span**: פסח's span runs from
  bedikas chometz to the last day with חול המועד in the middle, and a Friday in חול המועד is an
  ordinary Friday.
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
  **`(Mariv HH:MM)` is the one figure on the page that is not on a sheet.** An ערב יום טוב has a
  מעריב after each early מנחה where an ערב שבת cannot, and the shul's sent message puts all three
  exactly ten minutes after their פלג, which is where `YT_MAARIV_AFTER_PLAG` comes from. If the shul
  confirms those מנינים, the right home for them is the פסח sheet and the message reads them off it.
  **That sent message and the sheet disagree by a day**, measured: its 5:51/6:06, 6:27/6:42 and
  6:47/7:02 are 6 April 2026's פלג times exactly, while ערב שביעי was the 7th, whose are
  5:52/6:07, 6:28/6:43 and 6:48/7:03. Its own הדלקת נרות, 7:09, is the 7th's (the 6th is 7:08), so
  the message mixes two days and the candle line is the one that is right. The sheet is kept.
- Built so far: ערב ראש השנה, ערב יום כיפור, ערב סוכות, ערב שמיני עצרת, ערב פסח,
  ערב שביעי של פסח, and the two ותיקין announcements. Each is measured against the shul's own sent message before it is called done,
  line for line. A sheet that carries the same `calc` on several nights (פסח and סוכות both open
  every night of yom tov with a הדלקת נרות) is read with `ytFirst`, which takes the first, since
  the ערב block prints before the day blocks.
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
