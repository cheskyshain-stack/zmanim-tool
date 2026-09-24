# Shul View: twenty-year layout audit

## Scope

Date range: September 23, 2026 through September 22, 2046 (7,305 dates).
The automated daily check renders the actual display at 1920 × 1080, at 16:00 UTC on each date, using the current published schedule configuration and calendar calculations. It includes a development announcement and a dedication. Fixtures stay in the test browser; they are never saved or published.

The check detects vertical/horizontal schedule overflow, time cells extending outside their available width, adjacent times overlapping, missing or duplicated special-schedule source rows, and rendering exceptions. Source-data gaps are reported separately from layout failures.

Additional visual regression cases cover both themes, no announcements, one announcement column plus dedication, two announcement columns plus dedication, and a 4K screenshot. Dates include ordinary/exception weeks, Chol Hamoed, connected Rosh Hashanah/Shabbos, and Shabbos immediately preceding Pesach in 2045.

## Shared layout improvements

- Long prayer labels move above their times. This also happens when a side label would force a pair of times into a single-file stack.
- Prose such as “מיד אחר מוסף” occupies enough whole time slots; it cannot overlap the next numeric time.
- The weekday label column leaves more space for aligned times.
- Normal weeks retain generous spacing. Exception-heavy weeks reduce padding before attempting wider layouts; the new fallback does not reduce schedule font size.
- When either schedule panel needs more width, announcement cards move to the bottom information band instead of disappearing.
- A very full weekday reference can occupy two columns. Individual schedule columns retain matching proportions.
- Dense special schedules balance by measured content height rather than row count. Every source row stays in order and on screen; schedules do not rotate.
- Text measurement uses the loaded font without repeatedly adding invisible elements to the page.

## Repeating the checks

Run from `tv/`. Start the local Worker and local database on port 8797 using `wrangler.local.jsonc`; build assets with `npm run build`. Chrome and Playwright must be installed (set `NODE_PATH` if Playwright is supplied by the workspace runtime).

```powershell
node tests/twenty-year-layout.mjs
node tests/layout-review.mjs
$env:DISPLAY_TEST_URL='http://127.0.0.1:8797'
node --test --test-isolation=none tests/*.test.mjs
```

Optional daily-audit environment variables: `AUDIT_START`, `AUDIT_END` (exclusive), and `AUDIT_OUT`. The scripts write detailed reports/screenshots under the workspace `outputs` directory by default, and exit unsuccessfully if a layout or rendering check fails.

## Limits and source gaps

This is a presentation audit of the current source, not a confirmation of minyan times for the next twenty years. Future administrator edits, new content, font changes, and calendar-rule changes require rerunning it. Every date is checked at one daytime instant; it is not an exhaustive test of every minute. Existing separate tests cover New York/DST boundaries, appearance switching, schedule overrides, connected-day retention and next-minyan behavior.

The existing source does not contain complete Shavuos and Tisha B’Av special schedules. There are 154 affected daily snapshots in this date range, including days that preview an upcoming unavailable schedule (94) and affected actual days (60). Missing times must be supplied through the authoritative schedule source; this change does not invent them.

Published data, authentication, permissions, appearance settings, and announcement/dedication records are not changed by the audit.

## Final results

- 7,305 daily renders passed; zero detected layout failures or rendering errors.
- 66 theme/content variants passed, plus a 4K visual review.
- All 20 application tests and six existing complete-schedule browser cases passed.
- All special-schedule source row IDs were retained exactly in each daily render.
- The 154 source-gap snapshots remain explicitly listed in `twenty-year-layout-results.json`.
