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
5. Poll the live site until the change is actually there. GitHub Pages takes about a
   minute:
   `curl -s "https://lczmanim.cjaffa.com/?b=$(date +%s)" | grep -o 'app.css?v=[0-9a-f]*'`
   and compare against the local `index.html`. Do not tell the user it is live until the
   hash matches.

### build-offline.py does five jobs

Run it after **any** change to `js/`, `css/`, `data/`, or `assets/`:

- Builds `offline/`, a self-contained copy for a USB stick. It flattens every module into
  one plain script (no ES modules), inlines `data/*.json` (no `fetch`), and inlines the
  webfonts as base64 data URIs. All three of those are blocked under `file://`.
- Stamps `css/*.css` links in `index.html` with a content hash.
- Generates the JS **import map** in `index.html`, giving every module a content-hashed
  URL.
- Stamps the whole-address tags (canonical, `og:url`, `og:image`) from `SITE_URL`, the one
  place the domain is written. Moving to another domain is that line and a rebuild.
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
- Three rules are **seeded** (שבת הגדול, שבת שובה, ט באב), guarded by flags in
  `state.seeded` so deleting one stays deleted. Seeding skips a rule already covering the
  same special Shabbos, so browsers holding hand-made versions do not end up with two.
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

## Verify before you call it done

Generate a sheet and check: all pages 817px, rows equal within a page, interleaved order,
seeded rules firing (look for "דרשה" on מצורע/הגדול in a חורף sheet), no console errors,
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
