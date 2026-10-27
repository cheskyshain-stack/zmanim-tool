# Shared seating plans

The existing Seats page stays on GitHub Pages. This separate Cloudflare Worker
stores shared plans in a SQLite Durable Object and broadcasts changes through
WebSockets. It does not use or change the statistics Worker's archive or secret.

Each organizer enters a name and the existing Seats PIN, 4444. PIN checks happen
on the server before any plan can be read or changed. Sessions last 24 hours;
tokens stay in sessionStorage and are sent in an authorization header or the first
WebSocket message, never a URL. Failed PIN attempts are limited per IP address.
Only the congregation site's origin is allowed. Request logging is disabled.

Local plans and backups stay available. Sharing is opt-in: choose Save to site,
then Save this plan to the site. The second organizer chooses Shared plans and
opens that same plan. Each subsequent committed edit saves automatically. The
other person's name and active seat appear beside the chart. Draft typing remains
local until saved with Enter, Tab, Save, or selecting another seat.

Updates contain individual field and seat changes with their original values.
Changes to different seats merge; a conflicting change is rejected as a unit.
An unsynced version is kept as a separate local copy and a recovery record.
Undo/Redo affect the originating organizer's edits and refuse to erase a newer
change from the other organizer. Offline changes queue locally and rebase when
the connection returns. A local pending copy must sync before it is discarded.

The shared connection is separate from downloaded backups. Restoring a backup
creates independent local plans and cannot overwrite an online plan.

## Activate through GitHub

The source ships with `data/seats-sync.json` disabled, so the current local tool
keeps working until the online service has been deployed and verified.

1. In the Cloudflare account already used for the site, create a Workers deployment
   API token restricted to that account, with Workers Scripts Edit permission.
2. In this GitHub repository, open Settings, Secrets and variables, Actions. Add
   `CLOUDFLARE_API_TOKEN` as a repository secret. Never put its value in a commit,
   a seating plan, an issue, a workflow input, or a chat message.
3. Open Actions, Activate shared seating plans, Run workflow on main.

That workflow deploys only the new `zmanim-seats` Worker, verifies authenticated
storage, records the returned backend URL, and publishes the website. The API token
is passed only through the deployment command's environment. No seating names are
committed to GitHub or copied into the deployment output.

The existing Cloudflare account ID is already in `wrangler.jsonc`. If deploying
to another account, change that ID and verify its returned workers.dev address.
The account must support SQLite Durable Objects and have a workers.dev subdomain.
If Cloudflare reports account setup or a plan requirement, resolve that in the
Cloudflare dashboard before rerunning activation.

## Deploy from a computer instead

With Cloudflare access configured in Wrangler:

```sh
npx wrangler@4.152.0 deploy --config worker/seats/wrangler.jsonc
```

Set `data/seats-sync.json` to `{"endpoint":"https://<returned-worker-address>"}`,
then run the repository's normal build, checks and GitHub Pages publishing loop.
Deploy and verify the Worker before enabling that endpoint on the website.

## Verify locally

```sh
node --test tests/seats-sharing-model.mjs tests/seats-model.mjs tests/seats-records.mjs
python build-offline.py
node scripts/build-schedule-api.mjs
SEATS_WRANGLER_BIN=/path/to/wrangler node tests/seats-sharing.cjs
```

The browser test uses fresh random ports, a local Workerd runtime, isolated
temporary storage and three Chromium contexts. All test names are synthetic.
It checks server PIN protection, presence, simultaneous assignments, draft text,
Undo/Redo, offline reconnection, reload persistence, desktop and phone layouts.
The existing Seats browser and actual PDF print checks must also pass.

Chart dates and change history require the updated Worker. The activation workflow
has a service_only input to deploy and verify the Worker from a prepared branch
without publishing the website. Its normal run still connects and publishes the
site after the service check. The service uses the existing Durable Object and
keeps existing chart keys and revisions. Each accepted update writes the chart and
an append-only history entry together. GET /api/plans/:id/history returns 50 entries
at a time with a nextBefore cursor. Retries do not add duplicate history entries.
Older records retain their last known editor and time; unknown creation dates and
unrecorded earlier changes are not invented. GET /api/info reports support for dates
and history after sign-in.

The same PIN-protected service stores reusable name files at /api/name-lists.
Uploads normalize and deduplicate up to 2,000 names, retain their file ID across
retries, and record the uploading organizer and date. GET lists active files;
GET /api/name-lists/:id reads a file; DELETE removes it from the shared folder.
DELETE /api/plans/:id removes a shared chart. Deletion markers prevent old clients
and retried uploads from recreating removed files. Watched clients keep the latest
local chart copy when the shared file is deleted. All mutations require the server
session and the existing allowed origin. API feature verification now includes
sharedNameFiles and deleteFiles as well as changeHistory.

Editing name files also requires editNameFiles in /api/info. POST /api/name-lists/:id
updates a file in place using its revision and a stable operationId. The server keeps
creation metadata, records the latest editor and date, rejects stale revisions with
409 and deduplicates retries after a lost response. Legacy files start at revision 1.
Deleted files cannot be edited or recreated by an old retry. The editor keeps each
unfinished draft under lakewood-commons-seats-name-draft-v1-<file ID> on the device.
