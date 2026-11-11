# Private community calendar

New event categories are Shalom Zachor, Kiddush, Vort, Aufruf, Chasuna, Bar mitzva
shabbos, Bar mitzva dessert and Custom. Custom events require customCategory, a
plain-text name of up to 60 characters. It is validated and saved with the event.
The wedding ID remains Chasuna; older generic types remain accepted for existing
records. No event migration runs. Deploy customCategories:true before the new client.

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
limit. New bearer sessions expire at the first 3 a.m. in New York at or after
seven full days from sign-in. Tokens are stored hashed on the server. The browser
remembers new sessions across tab and browser closes.
Existing sessions keep their original expiration. Signing out removes the saved
session and invalidates its token on the server.
Removing or resetting an editor immediately invalidates their sessions. Reset also
disables their old password until the new invitation is claimed. The owner account
cannot be removed through the account-management screen.

## Simcha phone reminders

New events in the seven named simcha categories use phone reminder settings by
default. Managers can turn reminders off for an event. Existing explicit reminder
choices stay saved. Events previously saved with reminders off stay off.

Readers use Notifications, then Phone reminders, to opt in and set times for this
device. The default is 9 a.m. New York time on the event date, or Friday for a
Shabbos event. A device can set one rule for all simchas, then override individual
categories. Each rule has a same-day or day-before time and an optional separate
Friday time. Settings are private to the signed-in account and device subscription.
The All the same switch shows one shared time or the full seven-category list.
Individual rules stay saved while the shared time is selected.
Android can opt in through Chrome. On iPhone or iPad, open the calendar as a Home
Screen web app before allowing notifications.

The alarm combines events due at the same time on the same device into one alert.
It opens the simcha date and offers the event's manager a prompt to post an
announcement. Details stay in the signed-in calendar. A skipped New York time
moves forward by an hour, and a repeated time uses its first occurrence.

Enable this in production by deploying the Worker, then setting the encrypted
`CALENDAR_REMINDER_VAPID` secret on that same Worker. Check `wrangler secret list`
first and retain any existing key. For the first activation, generate the private
P-256 JWK directly into Wrangler's stdin:

```sh
node --input-type=module -e "import {generateKeyPairSync} from 'node:crypto'; process.stdout.write(JSON.stringify(generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'jwk'})))" | node worker/calendar/node_modules/wrangler/bin/wrangler.js secret put CALENDAR_REMINDER_VAPID --config worker/calendar/wrangler.jsonc
```

Keep the private JWK out of shell output, files, and Git. Confirm `phoneReminders`
and `reminderSchedules` are true in `/api/info` and the private reminder endpoints still reject anonymous
requests before publishing the client. Use synthetic subscriptions for automated
tests (`node --test tests/calendar-simcha-reminders.cjs`). `CALENDAR_REMINDER_BROWSER=1`
also exercises the settings and event form in Chrome against the local Worker.

All calendar events and account-management endpoints require a server session. There is no public
event endpoint in this phase. CORS is limited to the shul's origin. Writes validate
event types, real dates, time order and text lengths, take ownership from the session,
and reject stale revisions. Deleted-event markers prevent stale retries recreating an
event. Messages are plain text, with Hebrew and line breaks supported. Multi-day events
include both their start and end dates. Calendar notices do not change minyan rules.

## Test

The event editor uses one Details box, category and date, with independently optional
start and end times. It retains the existing title/location/description storage fields
and all older events. Empty times have no displayed label; an end time alone reads
Until. Deploy the shared validator with `optionalEventTimes` before the website.
The owner can preview the editor and congregation screens using View as. Those
previews are read-only and never change roles, announcement reads or activity totals.

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
Every message response uses authorName Shul, including legacy posts, without
rewriting stored original identity. PUT /api/announcements/:id accepts text,
revision and operationId from any owner/editor. It keeps the post's sequence,
creation time, position and read markers. Revision conflicts return 409; retrying
the same completed operation returns its saved result. Deleted posts cannot be
edited. GET /api/announcements/updates?after=<editCount> returns up to 100 update
index entries, with nextAfter for older pending updates. Status includes editCount
and canEdit. Editors keep unsaved text on failures/conflicts. Private activity totals
include announcementsEdited. Deploy announcementEditing:true before the client.
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

## Announcement dates and congregation history

Announcement managers can set optional `addedAt` timestamps on POST and PUT. The
server validates canonical UTC timestamps and rejects future dates beyond clock
tolerance. `createdAt` retains the original source/arrival time. IDs, sequences,
source receipts and per-account reads survive date edits. Edits use the existing
revision and operation ID checks, including date-only changes and retries.

Messages sort newest first by `addedAt || createdAt`, with sequence as a stable
tie-breaker. The derived date index is backfilled from the existing sequence index
once, without resetting the Durable Object or changing legacy records. Date cursor
pagination uses `nextCursor` and `?cursor=`; old numeric pagination remains supported.

Viewer accounts can retrieve only the last 10 New York calendar days, including
today. Managers keep full history; `?view=congregation` applies the same recent view
without granting permissions. The cutoff applies to feeds, updates and unread
counts. Moving a post out of that window removes it from open congregation lists
without deleting it. Status snapshots let counts change safely as messages age or
move dates. Verify `announcementDateEditing:true` and `announcementHistoryDays:10`
before publishing a date-editing client. Production checks must not create data.

## LC Text email connection

The owner can open Calendar access > LC Text connection to create a private Google
Apps Script, rotate its key or disconnect it. Editors, viewers and explicit admin
previews have no setup controls. The client checks emailImport:true before offering
setup, so the current calendar continues working while service deployment is pending.
Run scripts/activate-calendar.mjs on the authorized Cloudflare computer first; see
CODEX-DESKTOP-LC-TEXT-CONNECTION.txt for activation and the separate Google consent.
The manual calendar-sync.yml workflow can also deploy only this service if the
repository has its authorized CLOUDFLARE_API_TOKEN. It never resets the owner or
creates a production account/event/notification during verification.
Existing accounts, CALENDAR/CommunityCalendar, object name and v1 migration stay intact.

Use a new Google Apps Script project under ads@neileich.org. Run setupLcTextCalendar
once and authorize normal Google access. It creates only its own five-minute trigger;
the existing Commons Comments project/trigger stay intact. The script checks both
the exact subject New text message from Lc Text (848) 356-4187 and the Google Voice
originating phone 18483564187. Ads aliases are restricted to recipients of that alias.
It reads messages without modifying Gmail, excludes Spam/Trash and outgoing replies,
and can import the matching history first. Long scans resume in bounded runs, with
fixed search windows, oldest-first pages and a ten-minute overlap. Unconfirmed sends
retry with their original Gmail IDs. No ChatGPT Gmail connection or AI key is used.

GET/POST/DELETE /api/email-import and GET/POST /api/email-import/review require the
real calendar owner session. POST setup takes revision and includeExisting; only its
response contains the generated script/key. GET exposes status only. Store only the
key hash on the server; key rotation/disconnection immediately blocks the old script.
Keep generated scripts out of Git/logs and never put calendar login tokens in them.

Only POST /api/email-import/receive accepts requests without Origin, with its separate
X-Calendar-Inbox-Key. No CORS exception applies to any other path/method. It validates
the key, mailbox, exact subject, Google Voice phone, source ID and date again. Messages
are plain text; known Google Voice logo/account/help wrappers are removed. Preserve
actual wording, Hebrew, links and original email timestamps. Ambiguous, truncated or
oversized messages wait in an owner-only review list, with manual Post/Skip actions.
Source email details are never exposed in the congregation announcement response.

Source receipts, announcement ordering/counts and activity are saved atomically.
Gmail-ID receipts survive key changes, manual edits and deletion tombstones, so retry
cannot duplicate or restore a notification. Auto imports mark nobody as read. They
use the existing authenticated feed, read counters, Shul label and edit/delete rules.
Earlier imported messages retain their real dates and begin unread. Importing does
not send email, SMS or phone push notifications or change minyan schedules.

Tests use synthetic source emails and isolated Workerd/Google/browser fixtures:

```sh
node --test tests/calendar-email-import.mjs
node tests/calendar-email-import.cjs
```

## Shul SMS connection

Calendar access offers the owner a separate Shul SMS connection. GET/POST/DELETE
/api/sms-import require the real owner session. Creating or replacing a key returns
it once; the service stores only its SHA-256 hash. Status never exposes the key or
hash. Rotation and disconnection preserve every receipt and existing announcement.

Only keyed POST /api/sms-import/receive may omit Origin, alongside the existing
email receiver. Its X-Calendar-SMS-Key grants ingestion only, without a calendar
session, read permission or account management. All other routes retain origin
and role checks. A {check:true} request verifies the connection without posting.
Messages carry {id,text,receivedAt}. Preserve exact text, including Hebrew, CRLF,
quotes and up to 16,000 characters; no AI filtering, trimming or inferred fields.
Ordinary manual announcements retain their 4,000-character limit. SMS imports
can be edited up to 16,000 characters by existing calendar admins.

Stable source-ID receipts and announcement updates commit atomically. A changed
payload for the same source ID conflicts; valid retries reuse the receipt even
after an edit or deletion. Auto imports mark nobody as read, retain original
arrival timestamps, use author Shul and exclude source phone numbers and private
credentials from the feed. Keep all existing bindings and the v1 migration.

Deploy smsImport:true before publishing the setup client. The cloud workspace and
existing GitHub deployment lack Cloudflare authorization; use the authorized
computer and CODEX-DESKTOP-SHUL-SMS-CONNECTION.txt. Do not claim connected until
the owner creates its key and connects it in Shul SMS. Local write tests use only
synthetic records: node tests/calendar-sms-import.cjs checks Workerd and real
Chromium at phone and desktop widths. Never create synthetic production posts.

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

## Private activity totals

GET /api/activity accepts the statistics service's start/end/asOf parameters and
requires the calendar owner. It returns counts and daily buckets for successful
sign-ins, viewer registrations, calendar event changes, announcement posts/deletions
and feed opens. Dates and snapshots use the shared traffic-calendar.js policy.
Records contain timestamps and fixed operation types, without account details or
message text. They are written alongside successful mutations, including operations
from browsers excluded from page-view analytics. The original tracking-start value
is preserved; earlier ranges are Not tracked, never measured zero.

POST /api/announcements/open takes an operation id and returns the first message
page. Any signed-in account can open its feed. The id makes retries count once;
read markers remain separate. This endpoint accepts no client-supplied count/type.
Public analytics cannot read these private totals. Deploy activityStatistics:true
before its client. Keep existing bindings, accounts, events, posts and login history.
