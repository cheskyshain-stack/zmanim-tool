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
