# Private community calendar

Phase one is an admin-only preview at `/admin/#calendar`. The congregation homepage,
public navigation, schedule API, announcements and notification service are unchanged.
With `data/calendar.json` disabled, the main admin can add, edit and delete test events
in this browser. The view clearly labels device storage, offers an event backup and
restore, and can show examples without saving them. It never invents a shared login.

The separate `/admin/calendar/` entry is for calendar-only accounts once connected.
The ordinary admin PIN is a browser gate, not a server credential. The main calendar
admin creates one owner account using a private, one-use bootstrap link. The owner
invites editors by name and email. Each editor chooses their own password using an
invitation that works once and expires in seven days. No email is sent automatically.
Share invitations privately. Their tokens stay in URL fragments, are removed from the
address immediately, and travel only in POST bodies. Passwords and tokens are never
included in public site data, Git or application logs.

The owner sees all events, can edit or delete any event, and can invite, revoke or
reset editor access. Editors see the private calendar but can change only their own
events. Neither account grants schedule-settings, seating-plan or GitHub access.
Passwords use salted PBKDF2-SHA256 with 100,000 iterations, the supported Workerd
limit. Random bearer sessions last 48 hours and are stored hashed on the server.
Removing or resetting an editor immediately invalidates their sessions. Reset also
disables their old password until the new invitation is claimed. The owner account
cannot be removed through the account-management screen.

All calendar events and account endpoints require a server session. There is no public
event endpoint in this phase. CORS is limited to the shul's origin. Writes validate
event types, real dates, time order and text lengths, take ownership from the session,
and reject stale revisions. Deleted-event markers prevent stale retries recreating an
event. Messages are plain text, with Hebrew and line breaks supported. Multi-day events
include both their start and end dates. Calendar notices do not change minyan rules.

## Test

```sh
npm ci --prefix worker/calendar
python build-offline.py
node scripts/build-schedule-api.mjs
node --check offline/bundle.js
node --test tests/calendar-model.mjs tests/admin-home.mjs
node tests/calendar.cjs
```

The model checks monthly grids across 51 years, known parshas and Jewish holidays,
Gregorian leap dates, both leap-year Adars, date/time validation and device storage.
The browser test uses fresh ports, isolated synthetic records, Chromium and a real
local Workerd service. It checks 320/375/768/1440px layouts, month navigation, keyboard
navigation, day popups, Hebrew text, event persistence, backup, reduced keyboard
viewport, safe text rendering, owner registration, editor invitations, role limits,
concurrent edits, account revocation and reset, and unavailable storage. No real
calendar account, invitation, email or phone notification is used or sent.

## Activate the shared accounts after reviewing the preview

Use the Cloudflare account already authorized for the shul. This isolated Worker does
not change Seats, site statistics, Shul View or the pending announcements service.

```sh
npm ci --prefix worker/calendar
worker/calendar/node_modules/.bin/wrangler whoami
node scripts/activate-calendar.mjs
```

If the CLI is not authenticated, sign in normally on the user's computer before
activation. Do not paste credentials into chat or Git. `CALENDAR_WRANGLER_BIN` can
select an existing authorized Wrangler executable. The activation script deploys
only `zmanim-calendar`, verifies sign-in protection, and updates `data/calendar.json`.
It preserves an existing owner. On first setup, it puts a random bootstrap hash into
the Worker's secret storage and saves the private owner-registration link in a new
0600 file in the user's home directory, outside the repository. The raw token is not
printed. An unused setup link can be replaced by rerunning activation before an owner
has registered. Do not publish the private setup file or invitation links.

Rebuild, test and deploy the configured website through the normal deployment loop.
Open the private setup file to create the owner account, then use Calendar access to
invite the test editor. Any browser-only preview events remain local and are not
automatically uploaded. Shared accounts require this activation before they work on
the website. Publishing a congregation-facing calendar is a later, separate change.
