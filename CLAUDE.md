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
  grouping is unavailable it falls back to the UTC days and says so on screen. Do not "simplify"
  this back to `byDay`.
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
- **Triple click the heading** to drop the window and show every message the year holds, about
  fifty of them, and again to put it back. For checking, not for sending: nothing is stored and a
  reload is back to the four days. It listens on the heading rather than the page so that triple
  clicking a message to select it does not turn the year on.
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
