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
events. New readers register with their name, email and a password and immediately
receive viewer access. Viewers can read the calendar and announcements but cannot
change events, post announcements or manage accounts. No calendar role grants
schedule-settings, seating-plan or GitHub access.
Passwords use salted PBKDF2-SHA256 with 100,000 iterations, the supported Workerd
limit. Random bearer sessions last 48 hours and are stored hashed on the server.
Removing or resetting an editor immediately invalidates their sessions. Reset also
disables their old password until the new invitation is claimed. The owner account
cannot be removed through the account-management screen.

All calendar events and account-management endpoints require a server session. There is no public
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
The main admin can still download Previous device preview backups from the calendar
sign-in screen or Calendar access after connecting. Use the browser that created
those events; the backup keeps its original stored data and does not upload it.

## Private calendar announcements

Announcements in the calendar toolbar opens a message feed for signed-in calendar
accounts. Both owners and editors can post up to 4,000 characters with line breaks.
The server supplies the author and posting time. Messages are append-only, newest
first, with older messages available in pages of 30. Retrying the same post ID and
text returns the existing post instead of creating a duplicate.

GET /api/announcements/status returns the current account's unread count.
GET /api/announcements (and ?before=<sequence>) returns messages and read states.
POST /api/announcements takes {id,text}; POST /api/announcements/read takes {ids}.
DELETE /api/announcements/:id lets any owner or calendar editor remove any post,
regardless of its author. Viewers cannot delete. Repeated deletion succeeds without
changing counts again. Deleted posts are omitted from the ordering index and kept
with private recovery metadata; an old POST retry cannot restore them or read them.
The monotonic total remains the number of posts ever created. Deleted IDs count as
seen for every account, so unread counts exclude removed posts without double
counting existing reads. GET /api/announcements/deleted returns deletion IDs for
signed-in feed synchronization; it never returns deleted text. Status includes
deletedCount and canDelete. Open feeds remove those IDs without losing older loaded
messages or drafts. Confirm announcementDeletion:true before publishing the client.
All endpoints require the calendar session and allowed origin. Read markers belong
to the authenticated account, persist across devices, and are independent per post.
The author's own post starts read; it never clears other unread messages.
Only visible messages in the open feed are marked read; opening a page does not
clear unloaded older messages. Revocation and password reset invalidate access
through the same session checks as calendar events. No public feed, email or phone
notification is sent. The existing binding and v1 migration are unchanged.

Deploy this Worker before publishing a client that uses these endpoints. Verify
announcements:true in /api/info and unauthenticated HTTP 401 responses, without
posting real or synthetic messages to production. The calendar browser suite uses
local Workerd to test posting, lost responses, independent read counts, pagination,
cross-session persistence and revoked access.

## Viewer registration and private sign-in history

POST /api/register accepts {name,email,password} once the owner is set up. It
validates all fields, rejects existing or revoked emails and always creates a viewer,
ignoring submitted roles. Registration signs the reader in immediately. Viewer
accounts have a separate 2,000-account limit and do not consume the 20 calendar-admin
slots. They can read events and announcements and mark their messages read; all
event and announcement-content mutations require owner/editor access.

Only the owner may POST /api/access/:id/role with {role:"editor"} or {role:"viewer"}.
The owner's role cannot be changed. Permission changes invalidate existing sessions
while keeping the account, password, events, read states and history. Calendar access
offers these controls alongside the existing invitation and password-reset actions.

GET /api/access/activity lists each account's name, email, role/access state, recorded
sign-in count and first/last sign-in dates, including removed accounts. GET
/api/access/activity/:id returns 50 successful sign-ins, newest first, with nextBefore;
pass ?before=<sequence> for older records. Both endpoints require owner access.
Only session creation records a sign-in, including account creation and invitation
claim. Failed passwords, GET session checks and calendar refreshes do not increase
counts. Old sign-ins are not reconstructed. Activity records contain timestamps and
event types, not passwords, password hashes, session tokens or IP addresses.

The account forms explain that names, emails and sign-in times are visible to the
owner. No street address is collected. The user explicitly kept /texts/ open by
direct link; only calendar and announcement information requires calendar sign-in.
Verify selfRegistration:true and loginHistory:true after deploying the service,
before publishing its client. Keep the existing account records and CALENDAR v1
storage. Do not create production registrations or test sign-ins during activation.
