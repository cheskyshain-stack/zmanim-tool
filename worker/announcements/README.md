# Shul announcements and opt-in phone notifications

This separate Worker stores announcements, posting accounts and browser push
subscriptions in one SQLite Durable Object. It does not use or change the
statistics archive, Seats storage, the schedule settings or Shul View.

The public website has an announcements page. The separate posting page uses
server-checked accounts. The owner can create editor invitations and revoke
access. Editors can create, preview, save drafts, publish, edit and remove
announcements. They cannot manage accounts or the existing schedule settings.
The normal admin PIN is not used as server authentication.

Passwords use a salted 100,000-iteration PBKDF2 hash. Sessions are random bearer
tokens, stored hashed on the server and in sessionStorage on the client. They
expire in 48 hours; removing an account immediately invalidates its sessions.
Invitation links expire in seven days and work once. Their tokens are fragments,
removed from the browser address as the posting screen opens. They are never
emailed automatically. Share them privately. Request logging is disabled.

Messages are plain text with Hebrew and line breaks. An optional expiry removes
a message after that New York calendar date. Published messages appear newest
first. Drafts, account data and subscription endpoints are not public. Conflicting
edits require a reload rather than overwriting another editor's work.

Publishing for the first time queues an encrypted Web Push notification.
Editing, saving a draft or retrying an old revision does not queue another alert.
The Durable Object processes 20 subscriptions per alarm, retries transient failures
and removes expired endpoints. Delivery is best effort, subject to the browser,
phone and push provider. A consistent notification tag limits duplicate display
if an interruption happens after a push is accepted but before it is recorded.
Do not describe a queued alert as proof that a phone displayed it.

Each visitor opts in with a button. Permission is requested only from that click.
Opt-out unsubscribes the browser even if the server cannot be reached. iPhone
users must install the site to the Home Screen first on supported iOS versions.
The service worker has only push/click listeners and the /announcements/ scope;
it does not cache pages, intercept navigation or replace another site's worker.

Subscription URLs are restricted to supported HTTPS push providers with no
redirects. The VAPID private key is generated and kept in private server storage.
The public key is the only notification key returned to a visitor.

## Install and verify locally

```sh
npm ci --prefix worker/announcements
python build-offline.py
node scripts/build-schedule-api.mjs
node --check offline/bundle.js
node tests/announcements.cjs
node --test tests/admin-home.mjs tests/website-clock.mjs tests/schedule-feed.mjs tests/asara-bteves.mjs tests/shacharis-handouts.mjs
```

The browser test bundles the real Worker and runs it in local Workerd with
isolated storage. It uses synthetic owner/editor accounts, checks role boundaries,
drafts, conflicts, revocation, invitations, public rendering and phone/desktop
layouts. A local service binding captures every test push before it leaves the
runtime. The test independently decrypts a real RFC 8291 payload. Its browser
permission/subscription stub verifies opt-in and opt-out without subscribing a
real person or sending a real phone alert. The offline admin must also open.

## Activate with the user's Cloudflare account

The configured account is 04b085d9f19ac1ba6d333e0006fc94c1, already used by the
site's existing Workers. Use its normal authorized Wrangler login or an already
configured deployment token. Never read or paste credentials into chat or Git.

```sh
npm ci --prefix worker/announcements
worker/announcements/node_modules/.bin/wrangler whoami
# If needed, run the same command with login and let the user sign in.
node scripts/activate-announcements.mjs
```

The activation script deploys only zmanim-announcements, verifies access protection
and records the actual returned URL in data/announcements.json. If no owner exists,
it sets a random bootstrap hash as a server secret and saves the private setup link
in a new text file in the user's home directory, outside the repository. The raw
token is never printed. If an owner already exists, it preserves that account and
the existing notification keys.

Build and verify the configured website, merge and publish the prepared change,
then open that private owner setup file. Create the owner account and use Posting
access to create the test editor. Do not put the private setup file, account
passwords or private invitation links in Git, PR descriptions or deployment logs.

No paid plan is selected by the code or activation script. Existing account limits
still apply. If Cloudflare asks for a plan or billing change, let the user decide
before continuing. Keep the endpoint blank until the service has been deployed
and verified. Phone delivery must be checked on an opted-in real phone after
activation; a mocked browser permission check is not a real-device delivery test.
