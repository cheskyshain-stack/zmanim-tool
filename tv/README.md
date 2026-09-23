# TV display

Implemented on `feature/tv-display`. **Not deployed.** Production resources have not been created or changed.

## Routes and workflow

| Route | Purpose |
| --- | --- |
| `/display/` | Public 16:9 TV screen |
| `/admin/display/` | Server-protected dashboard, editors, future and unsaved previews, permissions |
| `/api/display/public` | Public projection of currently published content and applicable schedules |
| `/api/display/admin/*` | Authenticated administration APIs |
| `/display-assets/*` | Display/admin scripts, styles and the existing Hebrew font |

The existing main admin has a **Manage TV Display** navigation link. Its existing browser PIN is not sufficient authorization for the new APIs. The new server uses the Cloudflare Access JWT verification pattern already used by the private community calendar. The existing static website has no server-side capability table to reuse, so display capabilities are stored in its own D1 table.

1. Add an announcement or פרנס היום, or choose **Manage display schedules**.
2. Enter content and exact New York start/end times. Templates and timing shortcuts reduce typing.
3. Save a draft, inspect the actual screen in **Preview**, or **Publish**.
4. Find saved items in Showing now, Scheduled, Drafts, Expired, Hidden or Archive. Search title, internal name or sponsor.
5. Edit, duplicate, hide immediately or archive. A duplicate is an unpublished draft with its display dates cleared. Sponsorship dates are also cleared. Schedule applicable dates remain as a starting point, but activation dates must be reviewed and set again.

Publishing a text announcement never changes a schedule. Expiration does not delete anything. Archive requires confirmation and keeps the record.

## Local setup

Requires Node 24 (JSON import attributes), npm and a modern browser.

```powershell
cd tv
npm ci
npm run db:local
npm run dev
```

Open `http://127.0.0.1:8795/admin/display/` and `http://127.0.0.1:8795/display/`.

The local config binds only to loopback and enables `local-admin`. It is deliberately separate from production. Do not deploy `wrangler.local.jsonc`, expose the local server to the internet, or set `LOCAL_DEVELOPMENT=true` online. Local D1 persists in `tv/.wrangler/state`, independent of cookies and browser storage.

```powershell
npm test
npm run build
npx wrangler deploy --dry-run --config wrangler.jsonc --outdir test-results/worker-bundle
```

The last command only bundles locally. It does not deploy.

Browser verification uses Playwright with installed Chrome. If Playwright is not already available in the development environment, install it separately with `npm install --no-save --package-lock=false playwright`, then run `npm run test:browser`. Tests are local-only, create clearly labeled development fixtures, and archive them afterward. `DISPLAY_TEST_URL` can select another loopback port. Do not point these mutation tests at a live site.

## Production configuration, for the later deployment review

No production database, routes, Access application, or Worker deployment was made in this task. The checked-in `wrangler.jsonc` intentionally contains a placeholder database ID and empty sign-in settings. Administration fails closed until configured.

1. Review the site changes and TV screenshots first.
2. Create a D1 database and set its ID in a private copy named `wrangler.production.jsonc`. Keep the binding name `DB` and migrations directory `migrations`.
3. Set the following variables in that config or the Worker environment:

| Variable | Value |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | Existing team's hostname such as `your-team.cloudflareaccess.com`, without `https://` |
| `ACCESS_AUD` | Audience from the Access application protecting this admin |
| `DISPLAY_ADMINS` | Comma-separated bootstrap full-admin emails. Initial authorized administrator: `cheskyshain@gmail.com` |
| `LOCAL_DEVELOPMENT` | Must be absent in production |

4. Protect both `/admin/display*` and `/api/display/admin/*` with Cloudflare Access under the same application's audience, using the existing organization's sign-in. Add only authorized admin emails to its policy. Additional display capabilities are granted inside the TV dashboard. Access admission alone does not grant management permissions.
5. Keep `/display*`, `/display-assets/*`, and `/api/display/public` public. In particular, do not protect the entire `/api/display/*` tree with Access, because that would block the TV's read-only endpoint.
6. Route only these new paths to this Worker on the existing hostname:

```json
"routes": [
  { "pattern": "baismedrashoflakewoodcommons.org/display*", "zone_name": "baismedrashoflakewoodcommons.org" },
  { "pattern": "baismedrashoflakewoodcommons.org/admin/display*", "zone_name": "baismedrashoflakewoodcommons.org" },
  { "pattern": "baismedrashoflakewoodcommons.org/api/display/*", "zone_name": "baismedrashoflakewoodcommons.org" }
]
```

`/display*` includes the display assets. Leave the existing Pages origin and every other route in place. Do not assign a catch-all custom domain to this Worker. The main website's navigation update and the TV Worker should be released together after review.

7. After explicit deployment approval, run the two migrations against the production D1 binding, build assets, then deploy the reviewed config. These are the commands for that later step, **not commands already executed**:

```powershell
npx wrangler d1 migrations apply shul-display --remote --config wrangler.production.jsonc
npm run build
npx wrangler deploy --config wrangler.production.jsonc
```

Ensure that this hostname's Cloudflare zone is accessible to the deployment account before adding the routes. Zone/account access is a deployment prerequisite, not something this implementation changes. Review Worker CPU limits against the shared schedule calculations as part of staging; the local functional checks are not a Cloudflare production load test.

## Data and permissions

D1 migrations:

- `0001_display.sql`: content, capabilities, audit trail and visibility indexes.
- `0002_schedule_conflicts.sql`: transaction-level overlap protection, including concurrent saves. Distinct priorities can be reused when schedules do not overlap.

`display_items` holds a typed, validated payload plus structured UTC ISO timestamps, status, version, creator/editor identity and dates. Date-only sponsorship/applicable dates use `YYYY-MM-DD`. The API does not accept arbitrary saved JSON fields. The D1 JSON payload keeps the three editor shapes modular without three nearly identical lifecycle tables.

Capabilities can be combined:

- `full`: all display management plus permissions.
- `announcements`: announcement records only.
- `dedications`: פרנס היום records only.
- `schedules`: display schedule controls only.

Every mutation checks a verified Access JWT, server-stored permissions, same-origin submission, bounded JSON, allowed fields and record version. Concurrent edits return a conflict instead of overwriting another admin. Mutations and capability changes are audited. Hidden, archived and draft records are excluded from the public projection. Anonymous sponsor names, internal names, editor emails and audit details never appear in the public response. Entered text is escaped, not rendered as HTML.

## Schedule source of truth

`src/schedules.js` imports the site's actual calculation modules and `data/published.json`. It calls the same automatic chart builder, existing special-day posters, location conventions, candle-lighting and Hebrew calendar/solar functions. It contains no copied minyan-time lists.

The initial configurable special sources are the existing Rosh Hashana, Yom Kippur, Sukkos, Pesach and Tzom Gedalia builders. Their Hebrew-year date ranges are generated from the source. Normal holiday precedence is automatic, even with no display control records.

A display schedule control stores its name, source, applicable civil dates, optional advertising start, main activation/resume timestamps, affected portion, priority, and overlap acknowledgement. Higher priority wins for overlapping portions. **All portions provided by this source** preserves normal portions missing from a partial poster, such as the afternoon after Yom Kippur. Changing an advertisement's start does not change its applicable dates.

The existing code does not provide complete Tisha B'Av-day or Shavuos schedules. Those days show an explicit confirmation notice rather than inferred weekday times. Add accurate information to the shared source before extending those schedules; the display does not invent it.

The Worker bundles the shared source at build time. Rebuild/redeploy the TV Worker alongside changes to `data/published.json`, schedule formulas, overrides or location settings so the website and TV use the same release. New TV announcements/dedications and their scheduling do not require deployments.

## Timing and display behavior

- All entry and screen date logic uses `America/New_York`. Stored instants are UTC. Date labels include EDT/EST where times are being reviewed.
- Visibility is start-inclusive and end-exclusive. Public requests evaluate it on the server; the browser removes expired cards at the boundary and fetches at the next known start/end. The displayed clock advances from server time, so a mis-set device clock does not control visibility. Sunset and midnight also trigger refreshes. It also polls every 15 seconds to discover edits/new records without an admin visit.
- DST gaps are rejected. Repeated November times require selecting the first or second occurrence; the extra choice appears only when relevant.
- The dedication evening option is the preceding sunset through sunset on the selected daytime date, using the existing shul location and solar calculation. Civil-day mode is local midnight to the following midnight, including 23/25-hour days. Custom mode uses explicit instants. The editor shows the Hebrew/civil correspondence and exact timestamps.
- The 1920 x 1080 composition scales uniformly to 4K. Empty side columns disappear. Schedules remain steady; announcement and dedication rotations have independent state and keep the current card across successful refreshes.
- Announcements default to 25 seconds; dedications to 35 seconds, with a minimum of 25. Long messages continue on subsequent readable cards, with page indicators. No automatic font shrinking is used.
- One pinned announcement per side is prioritized. Additional cards rotate. When a dedication shares the right column, that column has one announcement rotation slot. Preview warns about excessive pinned cards and overflow. Keep titles/names short and use Preview for long or crowded content.
- Temporary connection loss retains the last successful schedule, prominently marks it stale and suppresses the next-minyan claim. On a cold offline load it shows an unavailable/reconnecting message rather than unverified cached times.
- Preview uses `DisplayView`, the same component as the public screen, with a server-calculated future snapshot. Unsaved content is sent only to the authenticated preview endpoint. It is not written or publicly exposed.

## Structure

- `src/worker.js`: routing, public projection, admin API, D1 operations and audit.
- `src/auth.js`: Access identity and capability enforcement.
- `src/model.js`: field validation, lifecycle, public redaction and conflicts.
- `src/schedules.js`: shared-site schedule adapter and Hebrew/civil/sunset conversion.
- `public/display-assets/renderer.js`: actual TV components and independent rotations.
- `public/display-assets/display.js`: public refresh/reconnection lifecycle.
- `public/display-assets/admin.js`: dashboard, editors, previews and permissions.
- `public/display-assets/time.js`: NY conversion, DST and lifecycle rules shared with the server.
- `scripts/build.mjs`: minified browser assets in `tv/dist`, separate from the existing Pages build.
- `tests/`: server, API, browser and seasonal layout checks.

The existing public website/donation source is unchanged. Outside `tv/`, the only behavior change is the admin navigation link; the existing schedule-cleanup function is exported for reuse, and the site's generated asset hashes/offline bundle are rebuilt.

## TV appearance

Manage TV Display → Appearance (full display managers only) offers Light, Dark,
and Scheduled. Light remains the default. Save appearance updates open screens
on the existing 15-second refresh cycle. The display evaluates the saved theme
every second, including while temporarily offline, using its last successful
server snapshot and elapsed time. No operating-system theme preference is used.

Scheduled start times are recurring America/New_York wall times. Dark applies
until the next Light transition, including across midnight. Identical times are
rejected. A nonexistent spring time runs at the first valid minute after the gap;
a repeated fall time runs on its first occurrence without switching back.

Preview Light / Preview Dark do not save. Use selected setting previews the
unsaved configuration. The existing future-time preview follows the saved setting.
Appearance saves use optimistic version checks and record actor/time in the audit.
The public response includes only the three appearance values, without audit data.

Before release apply `migrations/0003_appearance.sql` through the existing migration
workflow. No additional environment variables are required. This feature has only
been built and migrated locally; production deployment remains pending review.

Theme browser checks: `node tests/themes.cjs` with Playwright available and
`DISPLAY_TEST_URL` pointing at the local Worker. Screenshots contain explicitly
labeled preview-only content. No sample content is published by this test.

## Complete schedule presentation

The TV's `src/presentation.js` separates visual grouping from `scheduleSnapshot`
actual daily events. `next` still uses the dated, located event engine and active
special overrides; it never reads exception captions.

- The weekly reference is anchored Sunday through Shabbos for the entire week.
  Each service groups complete matching event signatures, including locations and
  notes. Small differences show exact replacement times, never inferred offsets.
  Holy days and relevant Erev portions refer to their special schedules.
- Shabbos reads all published chart columns through `rowFor`, including manual
  overrides. Special days read complete poster rows (times, named reckonings,
  extra rows, untimed labels and notes), not just the minyan collector.
- Consecutive sacred dates use the existing calendar classification. Their group
  crosses civil week boundaries and stays selected through its final closing
  events. A following sacred evening supersedes normal Motzai entries. On Erev
  Pesach that falls on Shabbos, the Pesach poster owns its morning and deadlines;
  the Shabbos chart supplies the remaining Shabbos sections.
- Pesach poster blocks now retain their existing serial date as additive metadata.
  No formula or public website styling changed. Root offline assets were rebuilt.
- `schedule-renderer.js` measures the full rows, adjusts schedule widths as needed,
  and paginates the special panel at 35 seconds per page. Heading/date/page count
  remain visible; the weekly panel stays steady. Every row keeps a source ID for
  coverage tests. Theme changes do not restart the page or announcement clocks.
- Current civil day and Hebrew date are separate from the weekly parsha and the
  upcoming special group.

No database migration or new permissions are required for this correction.
Both admin previews use the same presentation and renderer as `/display/`.

Source limitations: the existing catalog has no complete Shavuos schedule or
complete Tisha B'Av day schedule. Missing schedules are explicitly marked for
confirmation rather than populated with invented times. Display retention uses
the later of the source's last timed closing event and the existing 72-minute
sunset boundary, with the existing five-minute grace period; it does not claim to
know when an untimed event or service has actually finished.

Validation: `npm test`, `node tests/presentation-browser.cjs`,
`node tests/layout.cjs`, `node tests/themes.cjs`, and `node tests/lifecycle.cjs`.
Screenshots are in the shared workspace's `outputs/tv-schedules/`.
Production deployment remains pending review.

## Required follow-up after production deployment

User request: once the TV feature is deployed, add two links to the existing main
website's protected admin page:

- **View TV Display**: the deployed public `/display/` screen.
- **Manage TV Display**: the deployed protected `/admin/display/` management area.

Use the actual deployed URLs and existing admin navigation styling. Preserve
server-enforced permissions on the management destination. Verify both links
after deployment. Do not add live navigation links before deployment, and do not
treat this follow-up as authorization to deploy; production remains for review.


### TV schedule refinement

Yom Tov and Chol Hamoed use the full saved poster information with spaced times
instead of slash separators. Underlines and location marks remain intact.
The weekly panel includes the Chol Hamoed source rows and a distinct Hoshana
Rabbah section with its untimed instructions. Regular weekday patterns show full
lists on scoped lines, with calendar-derived Rosh Chodesh month, BeHaB and fast
names. These are presentation changes only; next-minyan calculation is unchanged.
Validated locally in both themes, including Chol Hamoed. Not deployed.

### Distance-readable TV redesign

The display now uses a slimmer header, larger 31px schedule times, stronger day
heading bands, highlighted weekly exception rows, clearer phone numbers and a
larger next-minyan strip. Dense weeks tighten spacing while keeping the same time
size. Complete special schedules retain numbered 35-second pages. Both themes
share the same geometry. Validated at 1920x1080 across 14 dates with side cards;
production deployment remains pending review.


TV layout refinement: regular prayer rows omit routine weekday names. Differing
patterns retain explicit day/occasion labels at the same size as prayer labels.
Times use aligned columns, preserving underlines and location marks. Panel titles
use חול פרשת, שבת פרשת, סוכות, שמיני עצרת / שמחת תורה, and חול המועד as applicable.
The modern Hebrew sans-serif style is now applied to the local display itself.

## Agreed TV heading hierarchy

- One שבת פרשת… heading covers Erev Shabbos, Shabbos and Motzai Shabbos.
- One overall Yom Tov heading covers the connected holiday schedule.
- Within that heading, use יום א׳ and יום ב׳ for unnamed numbered days.
- Where a day has its own established name, use that name instead of its day
  number, e.g. שמיני עצרת, שמחת תורה, שביעי של פסח, אחרון של פסח.
- Preserve the actual dates and all source entries; heading simplification must
  not change the schedule data or next-minyan calculation.
- Apply this hierarchy when integrating the fresh TV concept. Production remains
  undeployed and the HTML concept files are previews only.


## Admin preview calendar

Manage TV Display > Preview screen now opens a clickable month calendar. It shows
civil dates, Hebrew daytime dates, and holidays from the existing calendar rules.
Select a date to automatically request the protected future preview at the chosen
New York time. Month navigation, jump-to-month and Today are supported. Existing
DST occurrence controls and unsaved editor previews are preserved. No migration
is required. The newest HTML design concepts remain separate from the integrated
DisplayView; this calendar uses the actual integrated renderer, not the static
photo-based mockups. Future previews reflect currently saved data and may change
when administrators publish new content or schedules.
