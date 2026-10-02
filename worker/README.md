# Site statistics

The admin's Site Statistics page reads `traffic-worker.js`. The Worker alone reads
Cloudflare Web Analytics with the existing `CF_API_TOKEN` secret. Never place that
secret in the site, a fixture, a response, or this repository.

## Definitions and scope

- **Page views**: recorded views, including repeat views. Every chart and share uses this metric.
- **Entry visits**: Cloudflare's direct or external-referrer entries, not unique people.
- Tracking is installed on Home, Weekly Zmanim, Zmanim Chart, Special Schedules,
  and Donate. Admin tracking begins with the October 2026 admin update and runs only
  after its PIN is accepted or remembered. Shul View and Messages are not tracked.
- Offline use, blocked beacons, and the per-browser `?count=off` opt-out are not counted.
- Admin activity uses page views for `/admin/` and `/admin/index.html`, including
  internal arrivals. Its beacon disables SPA measurement so changing tabs does not
  count another open. Existing excluded browsers stay excluded. These are recorded
  opens, not identified people or a complete sign-in log; older visits cannot be recovered.
- Cloudflare can sample queries. A category mismatch is disclosed, never scaled to hide it.

## One window for every figure

Requests use inclusive `start=YYYY-MM-DD` and `end=YYYY-MM-DD`, interpreted in
`America/New_York`. `asOf` holds a shared snapshot while the user switches ranges;
Refresh starts a new snapshot. The source query is half open: `datetime_geq`
through `datetime_lt`. Today's end is capped at the snapshot. DST days contain
23 or 25 actual hours. The reader's device timezone does not change the dates.

The v2 response includes `range`, `snapshotAt`, `byDay`, `totals`, `groups`,
`coverage`, and `collection`. Each category includes its own sum and difference
from the headline. The frontend refuses a response with a different schema,
timezone, or date range.

**Zero** is a successfully collected period with no recorded views. **Unavailable**
is missing or unverified information. **Partial** totals include only known records.
Do not turn missing dates into zero or use whole UTC-day category totals under
New York date labels.

## Archive and migration

The existing `ARCHIVE` KV binding is retained. Old `m:YYYY-MM` records are read
without rewriting them. New completed UTC days use `d2:YYYY-MM-DD`, including
24 hourly totals and hourly category records. Independent daily keys prevent
concurrent writers from overwriting unrelated days in a monthly document.

Incomplete current days are transient snapshots. They never overwrite completed
archive records. Completed hourly totals are saved even if a category fails, with
that failure retained explicitly. Missing totals are repaired before repeatedly
failing details, so collection keeps progressing. Collection failures, unreadable archives, failed writes, and row
limits are surfaced. Failed or incomplete responses are not cached as successes.
Provider rate limits pause new collection for five minutes per source. During
that pause, available figures remain visible and the response reports the retry
time. A bounded in-memory snapshot also preserves recent partial-day figures.
Legacy nonzero hours remain available as partial history; unverifiable old quiet
hours are not claimed as measured zero. Old category summaries cannot be safely
split into local days, so recent dates are recollected instead.

Read repair and scheduled collection are bounded to five UTC days per invocation.
A shared budget includes upstream fetches and Cache API calls. Later invocations
continue missing history. The default source repair window is 30 days;
`CF_LOOKBACK_DAYS` can set 1 to 180. This is a collection budget setting, not a
claim about Cloudflare retention. Archive data outside that window stays readable.

The existing `0 4,5 * * *` cron remains valid. The Worker runs its scheduled
collection only at New York midnight, covering either DST offset. If no archive
is bound, the report queries the eligible selected window directly and clearly
reports the archive as disabled.

## Verification and publishing

Run from the repository root:

```sh
node --test --test-isolation=none tests/traffic-worker.mjs tests/traffic-view.mjs
python build-offline.py
```

Serve the built site on a fresh localhost port. Check desktop and 375px widths,
presets, custom dates, a selected chart day, complete zero, partial history,
service errors, and category discrepancies. `tests/traffic-fixture-from-legacy.mjs`
can turn a saved v1 response into a truthful local preview without inventing detail.

Production currently uses `zmanim-traffic.cheskyshain.workers.dev`, in Cloudflare
account `04b085d9f19ac1ba6d333e0006fc94c1`. This is separate from the Shul View
account. Preserve its existing secret, identity variables, ARCHIVE binding, and
cron. Deploy with Wrangler so `traffic-calendar.js` is bundled; pasting only the
main source file into the dashboard will not bundle that import.

The checked-in `worker/wrangler.jsonc` preserves the existing account, bindings,
identity variables, compatibility date, and schedule. Its `keep_vars` option
preserves server variables; the existing analytics token remains a server secret.
Publish with `wrangler deploy --config worker/wrangler.jsonc` after verification.

Before switching the frontend, verify the live schema accepts `datetime_lt` and
`datetimeHour` together with each category dimension. Compare one full New York
day and a range at a fixed `asOf`: daily values must add to the headline; category
sums either match it or explicitly explain the difference. Check collection errors
and coverage, not just HTTP 200. Publish the compatible Worker before the new UI.

The aggregate endpoint retains its existing public/CORS behavior. CORS is not
authentication. Closing this endpoint properly is a separate access-control change.
