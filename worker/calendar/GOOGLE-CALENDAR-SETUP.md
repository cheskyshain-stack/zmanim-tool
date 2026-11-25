# Optional Google Calendar connection

Status: Google configuration activated November 24, 2026 in the shul's
`lakewood-commons-calendar` project. Calendar API is enabled, the External app is
In production, and its only requested scope is the non-sensitive
`calendar.app.created` permission. The owner-approved public privacy notice is at
`https://baismedrashoflakewoodcommons.org/privacy/google-calendar/`.
The existing Worker's readiness and signed-out denial checks passed after its
three Google secrets were installed. Preserve those credentials and the existing
encryption key. Configuration readiness does not prove member consent or completed
event sync; each member must connect and approve Google access normally.
Do not create another
Worker, Durable Object, database or domain route. TV and Messages resources stay separate.

## What members get

Sign in to the website, open Calendar options > Google Calendar, then choose Connect.
Google asks the member to approve access. The service uses only
`https://www.googleapis.com/auth/calendar.app.created`: access to calendars created
by this app, rather than access to their personal appointments.
A separate Lakewood Commons calendar gets LC · event titles. Navy calendar styling
is optional: if Google rejects the calendar-list request, event sync continues and
styling retries at most hourly. Members may choose the color in Google. Reminder choices are off, 10 minutes,
30 minutes, one hour or one day before. Google and device settings control delivery.
Changing reminders never enables the website's separate phone push feature.

Only saved congregation-visible events sync. Private admin events and adminDetails,
account information, messages and device preview suggestions never get exported.
Source text, locations and New York civil times are preserved. Google requires an end
for a timed event: a source without one gets a clearly labelled estimated one-hour
end. Date-only events use Google's exclusive next-day end convention.

The existing Durable Object alarm reconciles each connection about once a minute,
in batches of at most 20 changes. Larger accounts take multiple batches. Updates and
deletions carry over. Google edits do not change the website. Turning off sync first
disables exports, then deletes only that member's app-created shul calendar and its
reminders. Cleanup retries temporary failures. Never claim cleanup succeeded until
status confirms it. If Google access has been revoked, the member must remove the
Lakewood Commons calendar in Google, then use Forget connection on the website.
Removing a site account also schedules cleanup through the ongoing sync alarm.

## Secure activation on the authorized computer

1. Use a Google Cloud project owned by the shul. Enable Google Calendar API.
2. Configure Google Auth Platform branding, audience and data access. The member
   consent screen should identify Bais Medrash of Lakewood Commons, with appropriate
   contact information, homepage and the public Google Calendar privacy notice.
   Complete Google's domain/consent requirements before general use.
   Use test users for the initial consent test; a testing app can have limited token
   lifetimes. Finish the production publishing/verification steps Google requires
   before relying on unattended member sync.
3. Create a Web application OAuth client. Register this exact authorized redirect URI:
   `https://zmanim-calendar.cheskyshain.workers.dev/api/google-calendar/callback`
   The existing website login remains separate; members also approve Google's consent.
4. Store these secrets directly in the existing Worker through the Cloudflare dashboard
   or interactive `wrangler secret put NAME --config worker/calendar/wrangler.jsonc`:
   * `GOOGLE_CALENDAR_CLIENT_ID`
   * `GOOGLE_CALENDAR_CLIENT_SECRET`
   * `GOOGLE_CALENDAR_TOKEN_KEY`, a cryptographically random 32-byte key encoded as
     exactly 64 hexadecimal characters. Keep a secure backup. Do not replace it while
     connections exist: it encrypts refresh tokens and pending authorization codes
     using AES-GCM with the member's site account ID as associated data.
   Never put values in Git, workflow output, screenshots, chat, or the browser app.
   The nonsecret redirect URI is already in the existing Wrangler config.
   Alternatively, download the Google Web client JSON outside this checkout and run:

   ```
   npm ci --prefix worker/calendar --no-audit --no-fund
   node scripts/activate-google-calendar.mjs "/absolute/path/outside/repo/client.json"
   ```

   Run it only on the computer with the shul's authorized Cloudflare login. The helper
   validates the exact Worker and callback, keeps any existing encryption key, backs
   up a newly generated key outside the repository (mode 0600 on Unix),
   and sends new credentials over stdin with Wrangler disk logs disabled. It refuses
   to replace existing OAuth client settings. It verifies readiness without a member
   session or production event writes. It does not approve Google consent or prove sync.
   See `CODEX-DESKTOP-GOOGLE-CALENDAR-CONNECTION.txt` in the repository root for the
   complete handoff, including Google Cloud project setup when needed.
5. Deploy the existing Worker from this revision on the computer with Cloudflare
   authentication, or configure the repository Actions secret `CLOUDFLARE_API_TOKEN`
   securely and run Deploy private calendar service. The cloud workspace does not
   assume the local production login or secrets are available. Existing bootstrap,
   VAPID and email/SMS secrets must remain unchanged. Deploy the service before
   exposing working controls on the website; the client checks `googleCalendar:true`
   and `available:true` and otherwise explains that activation is incomplete.
6. Verify with one consenting test member and a clearly labelled test event after
   activation: create, change, delete, reminder preference, account separation, turn
   off, confirm the shul calendar disappears, then reconnect. These external writes
   require that member's consent and are not part of the local test suite.

No member needs to connect Codex or share a Google password. Only the shul's OAuth
app setup and Cloudflare deployment access are needed, then each member consents
through Google when they choose to connect.

## Security and operational behavior

OAuth states are random, hashed in storage, expire in ten minutes and are bound to
the active site account version. PKCE protects code exchange. The one exact GET
callback is the only new Origin exception. Its redirect carries a one-use state in
the URL fragment, never a Google token. Finishing authorization requires the same
signed-in site account. Replays, expired states and other accounts fail closed.
Tokens are never returned to the browser, exported in backups, or logged.

Google operations are serialized per existing calendar object, checkpoint successful
writes, use stable event IDs and retry temporary errors without duplicating events.
Reappearing/deleted Google event IDs get a fresh checkpointed ID. A lost calendar
creation response is not blindly retried: the member sees an interrupted setup
message and should remove any empty Lakewood Commons calendar in Google before
turning off and reconnecting. Existing personal calendars are never addressed.
The service does not revoke a whole Google app grant during disconnect, because the
same Google account may be connected through another site account.

Validation:

```
node --test tests/calendar-google.mjs tests/calendar-google-activation.mjs tests/simcha-messages.mjs
node tests/calendar-google-service.cjs
node tests/calendar-simcha-import.cjs
python build-offline.py
CHROME_PATH=/path/to/chromium node tests/calendar-google-browser.cjs
CHROME_PATH=/path/to/chromium node tests/simcha-preview-browser.cjs
```

Google API tests use synthetic responses, not live Google accounts. Browser tests
use local synthetic accounts, make no production writes and inspect phone/desktop
controls. A real Google end-to-end connection remains an activation check.
