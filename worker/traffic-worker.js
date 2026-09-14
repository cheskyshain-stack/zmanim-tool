/* The one piece of this project that does not run in a browser.
 *
 * The admin's Traffic tab wants the site's visitor numbers, and those live at Cloudflare
 * behind an API token. A token cannot go in the admin: /admin/ is a public address behind
 * four digits that are explicitly not security (see js/ui/lock.js), and this repository is
 * public, so anything the page carries is published. So the token lives here instead, as a
 * Worker secret, and the admin asks this Worker rather than asking Cloudflare.
 *
 * What this is worth being clear about: this endpoint is open. CORS is a rule browsers keep
 * and anything else can ignore, and a key in the admin page would be as public as the page.
 * What it hands out is how many people read a shul's zmanim and which pages they opened,
 * aggregated, with nothing about any person in it. That is the trade, and it is written here
 * so nobody has to guess at it later. If it ever needs to be actually closed, that is
 * Cloudflare Access in front of the Worker, not a secret in the page.
 *
 * Deploying it, once:
 *
 *   1. Cloudflare dashboard, My Profile, API Tokens, Create Token, Custom token.
 *      Permissions: Account, Account Analytics, Read. Nothing else, so a leak of it reads
 *      numbers and cannot touch the site, the DNS or the Workers.
 *   2. Workers and Pages, Create, paste this file, deploy.
 *   3. On the Worker, add one variable: CF_API_TOKEN, the token from step 1, as a SECRET.
 *      That is the only value here that has to be kept, so it is the only secret asked for.
 *   4. Workers and Pages, KV, create a namespace, any name. Then on this Worker, Settings,
 *      Bindings, add a KV binding called exactly ARCHIVE pointing at it. This is where the
 *      shul's own record of its own numbers lives, and without it the tab is back to asking
 *      Cloudflare live and to the month Cloudflare keeps. Optional, but it is the whole point.
 *   5. Settings, Triggers, Cron Triggers, add `0 6 * * *`, which is a little after 1am in
 *      Lakewood. That is the daily collection. Optional too: without it the record still fills
 *      from whoever opens the tab, but only over the days somebody happened to look at.
 *   6. Give the Worker's address to whoever is editing the admin, and it goes in
 *      TRAFFIC_API in js/ui/traffic-view.js.
 *
 * There were three variables to set and now there is one, because the other two were work
 * with no secrecy to justify it. Both are looked up instead: the account from the token itself,
 * and the site from the beacon token the pages carry, which is written below and which every
 * visitor can read anyway. Both can still be overridden by a variable of
 * the same name.
 *
 * CF_ACCOUNT_ID is the one that has to be set by hand sometimes, and there are two such cases,
 * both of which the Worker names on the screen rather than leaving as a dead end: a token that
 * can see more than one account, where there is a real choice this cannot make, and a token
 * that /accounts hands back nothing for, which is what an account-owned token does. The value
 * is the 32 characters after dash.cloudflare.com/ in the dashboard address, and it is not a
 * secret: it is in the address bar of every page of the dashboard.
 *
 * The admin shows whatever comes back, errors included, verbatim. That is deliberate: the
 * shape of Cloudflare's analytics schema is the one thing here that cannot be checked from
 * this repository, so when it is wrong the admin says exactly how rather than saying
 * "something went wrong".
 */

/* Who may ask. The shul's own site and, so this can be worked on, a local server.
   Not a security boundary (see the note above); it is here so that a page on some other
   site cannot quietly read this in a visitor's browser and pass it off as its own. */
const ALLOWED = [
  'https://baismedrashoflakewoodcommons.org',
  // The address the site was on before it moved to the shul's own domain. Kept so the admin
  // still answers while DNS is settling and on any browser holding the old link. It can come
  // out once nobody is opening that one.
  'https://lczmanim.cjaffa.com',
  'http://localhost',
  'http://127.0.0.1',
];

/** How long a reply is reused before Cloudflare is asked again.
 *
 *  It was five minutes, and five minutes was too long for a reason that only shows up once there
 *  is more than one range to pick from. Each range is cached on its own, so the buttons can be
 *  showing moments several minutes apart, and that produced a screen where **30 days read lower
 *  than 7 days**: the long range was a five minute old snapshot sitting next to a fresh short
 *  one. A longer range showing less than a shorter one is not a stale number, it is an
 *  impossible one, and it costs the reader their trust in all the other figures on the page.
 *
 *  Forty-five seconds instead. Long enough that a tab left open on a desk, or a reader clicking
 *  between ranges, is not asking Cloudflare each time; short enough that two ranges can no
 *  longer disagree by anything this shul would notice. The reply carries the time it was taken,
 *  and the screen prints it, so whatever drift is left can be read rather than guessed at. */
const CACHE_SECONDS = 45;

/** Which version of this Worker wrote a cached reply, and part of the key it is filed under.
 *
 *  Deploying a Worker does not empty the cache it wrote into, so for five minutes after a deploy
 *  the new code goes on serving the old code's answer. That is a genuinely confusing five
 *  minutes: the change was made, the Worker says it deployed, the screen is unchanged, and it
 *  reads as the paste not having worked. It happened, so this exists.
 *
 *  **Change this on any deploy that changes the shape of the reply.** A date and a letter is
 *  enough; nothing reads it but the cache. */
const BUILD = '2026-09-14b';

/** The most days that can be asked for at once, so a mistyped range cannot ask for something
 *  absurd. Cloudflare itself is never asked past LIVE_DAYS; everything beyond that is the
 *  archive's, which is why this is years rather than a month. */
const MAX_DAYS = 800;

/** The beacon token, out of the congregation site's own head. Public by construction, since
 *  every visitor's browser is handed it. See ANALYTICS_TOKEN in build-offline.py. */
const SITE_TOKEN = 'e96217102b81416db30f31a0c105fece';

/** The host the congregation's pages are served from. The other way of saying which site, used
 *  where the site tag cannot be had. Same value as SITE_URL's host in build-offline.py.
 *
 *  **This is one host, and the site has had two.** Everything Cloudflare recorded before the move
 *  to the shul's own domain was recorded against lczmanim.cjaffa.com and is not in this query.
 *  Narrowing by the site's tag would have spanned both, since it is one Web Analytics site either
 *  way and the beacon token did not change, but that listing is refused for this token (see
 *  siteTagFor), so the host is what there is. The store is what carries history across a change
 *  like this: days already collected into it keep their figures whatever the site is called
 *  afterwards, which is one more reason to have the namespace bound before anything moves. */
const SITE_HOST = 'baismedrashoflakewoodcommons.org';

/** The account the site sits in.
 *
 *  Asked of Cloudflare with the same token rather than typed in: a token is issued against an
 *  account and can be asked which, so making somebody copy a 32-character string out of a
 *  dashboard URL was a step that existed only because this file did not think to ask.
 *
 *  Cached on the Worker for as long as the isolate lives, which is what stops this being an
 *  extra request on every call. CF_ACCOUNT_ID still wins if it is set, and it has to be set
 *  where the token can see more than one account, since then there is a real choice to make
 *  and this cannot make it. That case says so rather than guessing. */
let knownAccount = null;
async function accountFor(env) {
  if (env.CF_ACCOUNT_ID) return env.CF_ACCOUNT_ID;
  if (knownAccount) return knownAccount;
  const res = await fetch('https://api.cloudflare.com/client/v4/accounts?per_page=50', {
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const said = body?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Could not ask Cloudflare which account this token is for: ${said}`);
  }
  const list = body.result || [];
  if (!list.length) {
    throw new Error('This token is attached to no account, so this cannot work out which account '
      + 'to ask about. Set CF_ACCOUNT_ID on this Worker, as a plain variable, to the 32 characters '
      + 'after dash.cloudflare.com/ in the dashboard address. If the numbers still do not come, the '
      + 'token is missing Account, Account Analytics, Read, or was made without an account picked '
      + 'under Account Resources.');
  }
  if (list.length > 1) {
    throw new Error('This token can see more than one account, so CF_ACCOUNT_ID has to say which: '
      + list.map((a) => `${a.name} = ${a.id}`).join(', '));
  }
  knownAccount = list[0].id;
  return knownAccount;
}

/** Which site's numbers, as the analytics API names sites.
 *
 *  A Web Analytics site has two identifiers and they are not interchangeable. The **token** is
 *  what goes in the page, in data-cf-beacon, and is what the dashboard shows under the snippet.
 *  The **tag** is what the GraphQL dataset filters on. This file used to assume they were one
 *  string, which is the sort of assumption that fails quietly: the query ran, matched nothing,
 *  and the admin said "no visits counted in this period yet" while the dashboard was showing 50
 *  page views on the same day. An answer of zero is indistinguishable from a quiet zero, which
 *  is why the wrong one stood for a day.
 *
 *  So the tag is looked up rather than assumed: the account's sites are listed and the one whose
 *  site_token is the beacon token in the page is this site. Cached for the life of the isolate,
 *  like the account.
 *
 *  This can be refused, and on the shul's own Worker it is: the read-only Account Analytics token
 *  queries the analytics data happily and gets "Authentication error" from this REST endpoint,
 *  which is a different permission. That is not fatal and does not ask anybody for a second
 *  setting, because the site can be named another way: by the host its pages are served from.
 *  So this returns null rather than throwing, and the caller narrows by requestHost instead.
 *
 *  CF_SITE_TAG still wins over both, for the day one of them is wrong. */
let knownSiteTag = null;
async function siteTagFor(env, account) {
  if (env.CF_SITE_TAG) return env.CF_SITE_TAG;
  if (knownSiteTag) return knownSiteTag;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/rum/site_info/list?per_page=100`,
      { headers: { authorization: `Bearer ${env.CF_API_TOKEN}` } },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) return null;
    const mine = (body.result || []).find((s) => s.site_token === SITE_TOKEN);
    knownSiteTag = mine?.site_tag || null;
    return knownSiteTag;
  } catch {
    return null;
  }
}

/* What is asked for, and why it is asked for one grouping at a time.
 *
 * rumPageloadEventsAdaptiveGroups is Cloudflare's own Web Analytics dataset: one group per
 * bucket, `count` being page views and `sum { visits }` being visits, which is the pair the
 * dashboard shows. The same range is asked about several ways over: per day, per page, per
 * device, per hour, per referrer, per browser, per operating system.
 *
 * Every one of those is a separate HTTP request, which looks wasteful and is deliberate. One
 * GraphQL document with seven aliases in it fails as a whole: a single dimension this account's
 * schema spells differently takes the entire screen down, including the panels that were fine.
 * The dimension names here cannot be checked from the repository this Worker is kept in, so they
 * are educated guesses until the day somebody runs them. Separate requests make a wrong guess
 * cost exactly one panel, which then says what Cloudflare said about it, and the rest still draw.
 * They go out together, so the wall-clock cost is one round trip, and the whole reply is cached
 * for five minutes anyway.
 *
 * Every one is narrowed to this one site, because an account can hold several, and there are two
 * ways to say which: the site's tag, or the host its pages are served from. Which one is used
 * depends on whether the tag could be had at all (see siteTagFor), and the reply says which so
 * the admin can show it.
 *
 * The narrowing is written into the query text rather than passed as a variable. A variable
 * needs its type named, Cloudflare's filter input types are long and version-specific, and
 * getting one wrong is a query that does not run at all. What is interpolated is this file's
 * own constants or a tag out of Cloudflare's own API, never anything a caller sends. */
/* Each panel names the dimensions it would accept, best first, rather than one it insists on.
 *
 * The names cannot be checked from here. This Worker is kept in a repository on a machine that
 * cannot reach Cloudflare at all (api.cloudflare.com, the workers.dev address and the dashboard
 * all refuse to open a connection), so a name written here is a guess until it runs. It is not
 * a permissions problem and a token would not fix it.
 *
 * So the Worker finds out instead of being told: it asks with the first name, and if Cloudflare
 * says there is no such field it asks with the next. Whichever answers is remembered for the
 * life of the isolate, so the cost of being wrong is one extra request, once. A panel with no
 * name that works says so and prints what Cloudflare said about the last one it tried.
 *
 * Every fallback has to answer the same question as the name in front of it. That rules out the
 * tempting one: `date` would be accepted where `datetimeHour` is not, and it would quietly make
 * every visit look like midnight. A fallback that is accepted and wrong is worse than a panel
 * that is missing, because only one of those two says anything. */
const GROUPS = [
  // The two that are known to work, since they are what the tab has been drawing all along.
  { key: 'byDay', dims: ['date'], limit: 100, byDim: true },
  { key: 'byPage', dims: ['requestPath'], limit: 25 },
  // Phone or desk. The one number that settles an argument rather than starting one.
  { key: 'byDevice', dims: ['deviceType'], limit: 10 },
  /* When the board is read. A month is 744 hours and the limit has to clear that or the tail of
     a 30 day range goes missing without saying so. The admin folds these into 24 buckets; they
     are asked for as real instants because the day they fall on is what makes that fold correct
     across a timezone. Every fallback here still carries an hour, for the reason above. */
  { key: 'byHour', dims: ['datetimeHour', 'datetimeFifteenMinutes', 'datetimeMinute', 'datetime'], limit: 800, byDim: true },
  // How people got here: a link someone sent, a search, or typed in (which reports as nothing).
  { key: 'byReferer', dims: ['refererHost', 'refererDomain', 'referer'], limit: 15 },
  // Asked separately rather than as one two-dimension group, which would multiply out into a
  // row per combination and answer neither question on its own.
  { key: 'byBrowser', dims: ['userAgentBrowser', 'browser'], limit: 10 },
  { key: 'byOS', dims: ['userAgentOS', 'os', 'operatingSystem'], limit: 10 },
];

/** The dimension each panel settled on, once one of them worked. Per isolate, like the account
 *  and the site tag, so the probing happens once and not on every reader's reload. */
const settledDim = new Map();

/** How the last collection named this site, kept for the read path. See gather. */
let lastNarrowedBy = null;
let lastSite = null;

const groupQuery = (where, g, dim) => `
query Traffic($accountTag: string!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      rows: rumPageloadEventsAdaptiveGroups(
        limit: ${g.limit}
        filter: { ${where}, datetime_geq: $since, datetime_leq: $until }
        orderBy: [${g.byDim ? `${dim}_ASC` : 'count_DESC'}]
      ) {
        count
        sum { visits }
        dimensions { ${dim} }
      }
    }
  }
}`;

/** One grouping under one dimension name, as `{ rows }` or as `{ error }`. */
async function askOne(env, account, where, since, until, g, dim) {
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.CF_API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query: groupQuery(where, g, dim),
        variables: { accountTag: account, since, until },
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { error: `Cloudflare answered ${res.status}` };
    if (body?.errors?.length) return { error: body.errors.map((e) => e.message).join('; ') };
    const rows = body?.data?.viewer?.accounts?.[0]?.rows;
    if (!rows) return { error: 'Cloudflare returned nothing for this grouping.' };
    return {
      dim,
      rows: rows.map((r) => ({
        key: r.dimensions?.[dim] ?? '',
        views: r.count,
        visits: r.sum?.visits ?? 0,
      })),
    };
  } catch (e) {
    return { error: `Could not reach Cloudflare: ${e.message}` };
  }
}

/** One grouping, under whichever of its names Cloudflare will answer to.
 *
 *  Never throws. A panel that cannot be had is a panel that says why, next to the ones that
 *  could, and what it says is Cloudflare's own words about the last name tried.
 *
 *  Only a complaint about the name itself moves on to the next candidate. Anything else, a
 *  refused token or an account that answered nothing, is the same answer whatever the dimension
 *  is called, and trying three more names for it would be three more requests to be told the
 *  same thing. */
async function askGroup(env, account, where, since, until, g) {
  const known = settledDim.get(g.key);
  const names = known ? [known] : g.dims;
  let last = { error: 'No dimension tried.' };
  for (const dim of names) {
    const got = await askOne(env, account, where, since, until, g, dim);
    if (got.rows) {
      settledDim.set(g.key, dim);
      return got;
    }
    last = got;
    if (!/field|dimension|unknown|cannot query|no such/i.test(got.error || '')) break;
  }
  return last;
}

/** The origin to answer with, or null where the caller is not one of ours.
 *
 *  Matched on the scheme and host rather than by string equality, so a local server on any
 *  port is one caller rather than a list of ports nobody will remember to keep up. */
function allowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  try {
    const u = new URL(origin);
    const base = `${u.protocol}//${u.hostname}`;
    return ALLOWED.includes(base) ? origin : null;
  } catch {
    return null;
  }
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin || 'null',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

/** A reply, with the numbers kept for a while and a failure kept not at all.
 *
 *  The freshness header goes on an answer and never on a refusal. It used to go on both, and
 *  that turned every failure into a five minute one: a setting was corrected, the Worker was
 *  redeployed, and the admin went on showing the browser's copy of the old complaint, which
 *  reads exactly like the correction not having worked. Whoever is looking at an error is
 *  about to change something and reload, and that reload has to ask. */
function json(body, status, origin) {
  const ok = status >= 200 && status < 300;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': ok ? `public, max-age=${CACHE_SECONDS}` : 'no-store',
      ...corsHeaders(origin),
    },
  });
}

/** Midnight UTC, n days back and n days forward, as the API wants them.
 *
 *  Whole days rather than a rolling window, so the last bucket is today so far and the ones
 *  before it are whole days that will not change under the reader. */
/** One window, given by the caller as two instants, or nothing.
 *
 *  The ranges above are whole UTC days, which is the wrong shape for "what happened on Tuesday":
 *  Lakewood's Tuesday starts at 04:00 or 05:00 UTC, so a UTC day holds the last of Monday evening
 *  and none of Tuesday evening. The admin knows which timezone its reader is standing in and the
 *  Worker does not, so the browser works the two instants out and sends them, and every panel in
 *  the answer is then about that one day rather than about a UTC day that overlaps it.
 *
 *  Refused rather than guessed at if either instant will not parse, if they are the wrong way
 *  round, or if the span is longer than MAX_WINDOW_DAYS: a mistyped parameter should come back as
 *  an error and not as an answer about some other stretch of time. */
const MAX_WINDOW_DAYS = 40;
function askedWindow(params) {
  const rawSince = params.get('since');
  const rawUntil = params.get('until');
  if (!rawSince && !rawUntil) return null;
  const since = new Date(rawSince);
  const until = new Date(rawUntil);
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    return { error: 'since and until must both be times this Worker can read, like 2026-09-14T04:00:00.000Z.' };
  }
  const span = until.getTime() - since.getTime();
  if (span <= 0) return { error: 'until has to be after since.' };
  if (span > MAX_WINDOW_DAYS * 86400000) {
    return { error: `since and until are more than ${MAX_WINDOW_DAYS} days apart.` };
  }
  return { since: since.toISOString(), until: until.toISOString() };
}

function dayRange(days) {
  const until = new Date();
  const since = new Date(until.getTime() - (days - 1) * 86400000);
  since.setUTCHours(0, 0, 0, 0);
  return { since: since.toISOString(), until: until.toISOString() };
}

const dayOf = (iso) => String(iso).slice(0, 10);
const hourOf = (iso) => Number(String(iso).slice(11, 13));

/* ── The shul's own record, and why the screen reads that and not Cloudflare ────────────────
 *
 * **Cloudflare is collected from, not read from.** The admin's Traffic tab used to put its
 * question to this Worker, which put it to Cloudflare, every time somebody pressed a range
 * button. That is why the shul saw two screens that could not both be right: Today counted from
 * local midnight out of the hourly buckets, the seven day chart fell back to Cloudflare's UTC
 * days because the hourly detail does not reach back a week, and the bar over today held the
 * evening before while Today did not. Two questions to Cloudflare, answered on two different
 * clocks, sitting next to each other on one screen.
 *
 * So the shape is now collector, store, reader, which is what the shul asked for in those terms:
 *
 *   **Collect.** A daily cron pulls every day Cloudflare still has, one whole UTC day at a time,
 *   and writes each into the store. Opening the tab refreshes **today** and nothing else, because
 *   today is the only day whose figures are still moving.
 *
 *   **Store.** One key a month, holding each day of it as 24 hours of visits and page views plus
 *   that day's pages, devices, browsers, systems and referrers. Hours because the screen folds
 *   them into Lakewood days and that fold needs the hour. A month a key because a write then
 *   touches one small value: refreshing today on every tab open rewrites the current month and
 *   never the history, and a year of reading is twelve gets rather than three hundred.
 *
 *   **Read.** Every figure on the tab is a slice of the store: any range, any single day, the
 *   hours of the day, the days of the week. Nothing on the read path asks Cloudflare a question
 *   about a period, so no period can be answered on a different footing from the one beside it,
 *   and a day older than the month Cloudflare keeps is as answerable as yesterday.
 *
 * What does not change, and is worth saying plainly rather than discovering: **the record starts
 * when the collecting starts.** Cloudflare keeps about a month, so the first cron backfills the
 * thirty days it still has and no more. A full year of history is real a year from now.
 *
 * **The binding is optional and this Worker runs without it.** With no ARCHIVE bound it asks
 * Cloudflare on the read path exactly as it always did, and says `archive: 'off'` so the screen
 * can say so. That matters because the alternative is a Worker that cannot be deployed until a
 * namespace exists, and a half-deployed Worker is how the numbers went missing for a day once
 * already. */

/** One key a month, `m:2026-09`, holding `{ "2026-09-14": <day>, ... }`.
 *
 *  It was one key for everything. That had to be rewritten whole on every write, which is fine
 *  once a day and wrong for a store that is written every time somebody opens the tab: a hundred
 *  kilobytes rewritten to correct one hour, and two writers dropping each other's work over the
 *  whole record rather than over one month. */
const monthKey = (date) => `m:${String(date).slice(0, 7)}`;

/** What months a window touches, oldest first. */
function monthsBetween(fromDate, toDate) {
  const out = [];
  const at = new Date(`${fromDate.slice(0, 7)}-01T00:00:00Z`);
  const last = `${toDate.slice(0, 7)}`;
  for (let i = 0; i < 400; i += 1) {
    const m = at.toISOString().slice(0, 7);
    out.push(m);
    if (m >= last) break;
    at.setUTCMonth(at.getUTCMonth() + 1);
  }
  return out;
}

/** The dates a window touches, oldest first, as UTC dates. */
function datesBetween(fromDate, toDate) {
  const out = [];
  const at = new Date(`${fromDate}T00:00:00Z`);
  for (let i = 0; i < MAX_DAYS + 2; i += 1) {
    const d = at.toISOString().slice(0, 10);
    out.push(d);
    if (d >= toDate) break;
    at.setUTCDate(at.getUTCDate() + 1);
  }
  return out;
}

async function readMonths(env, months) {
  if (!env.ARCHIVE) return null;
  try {
    const got = await Promise.all(months.map((m) => env.ARCHIVE.get(monthKey(m), 'json')));
    const out = new Map();
    months.forEach((m, i) => out.set(m, got[i] || {}));
    return out;
  } catch {
    return null;
  }
}

/** Whole days written into their months, one read and one write a month touched.
 *
 *  Read, merge, write, which can lose a day to a racing writer. That is the same bargain the
 *  single key made and it costs less now: the loser's day comes back on the next collection,
 *  and the only day written often enough to race is today, which is rewritten on the next
 *  opening of the tab in any case. */
async function writeDays(env, days) {
  if (!env.ARCHIVE || !days.size) return;
  const byMonth = new Map();
  for (const [date, rec] of days) {
    const m = String(date).slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, new Map());
    byMonth.get(m).set(date, rec);
  }
  await Promise.all([...byMonth].map(async ([m, entries]) => {
    try {
      const store = (await env.ARCHIVE.get(monthKey(m), 'json')) || {};
      for (const [date, rec] of entries) store[date] = rec;
      await env.ARCHIVE.put(monthKey(m), JSON.stringify(store));
    } catch {
      // A month that will not write is a screen with less history on it, not a broken screen.
    }
  }));
  await touchIndex(env, [...days.keys()]);
}

/** What the store holds and when it was last added to, in one small key, so the screen can say
 *  how far back the record goes and how fresh it is without reading a year of months.
 *
 *  Freshness earns its place: a store that stops being collected into does not look broken, it
 *  looks like a quiet week. The screen has to be able to tell those apart, which means it has to
 *  be told when the record was last written rather than inferring it from the numbers in it. */
const INDEX_KEY = 'index';

async function readIndex(env) {
  if (!env.ARCHIVE) return null;
  try {
    return (await env.ARCHIVE.get(INDEX_KEY, 'json')) || { from: null, to: null, days: 0, at: null };
  } catch {
    return null;
  }
}

async function touchIndex(env, dates) {
  if (!env.ARCHIVE || !dates.length) return;
  try {
    const now = new Date().toISOString();
    const at = (await env.ARCHIVE.get(INDEX_KEY, 'json')) || { seen: {} };
    at.seen = at.seen || {};
    for (const d of dates) at.seen[d] = 1;
    const all = Object.keys(at.seen).sort();
    await env.ARCHIVE.put(INDEX_KEY, JSON.stringify({
      seen: at.seen, from: all[0], to: all[all.length - 1], days: all.length, at: now,
    }));
  } catch {
    // Same as a month that will not write.
  }
}

/** A day's record, out of one single-day answer from Cloudflare.
 *
 *  Built from the hourly grouping and only from it. A day total with no hours under it cannot be
 *  folded into a Lakewood day later, so storing one would be storing something that reads as
 *  history and answers the wrong question for ever after.
 *
 *  The categorical breakdowns are the day's own, which is the whole reason the collector asks one
 *  day at a time: asked over a range they come back for the range, and a range's totals filed
 *  against one date is a lie, while split across its days it is an invention. */
function dayRecord(out, date) {
  const rec = { v: new Array(24).fill(0), w: new Array(24).fill(0), at: new Date().toISOString() };
  for (const r of out.groups.hour.rows || []) {
    if (dayOf(r.key) !== date) continue;
    const h = hourOf(r.key);
    if (!(h >= 0 && h < 24)) continue;
    rec.v[h] += r.visits;
    rec.w[h] += r.views;
  }
  const put = (key, group) => {
    if (!group?.rows) return;
    rec[key] = Object.fromEntries(group.rows.map((r) => [r.key || '(none)', [r.visits, r.views]]));
  };
  put('p', out.groups.page);
  put('d', out.groups.device);
  put('b', out.groups.browser);
  put('o', out.groups.os);
  put('r', out.groups.referer);
  return rec;
}

/** One whole UTC day, collected. */
async function collectDay(env, date) {
  const since = `${date}T00:00:00Z`;
  const until = `${date}T23:59:59Z`;
  const out = await gather(env, 1, { since, until });
  if (out.groups.hour.error) throw new Error(out.groups.hour.error);
  return dayRecord(out, date);
}

/** Today so far, collected. The only day the read path ever asks Cloudflare about, because it is
 *  the only day whose figures are still moving. */
const utcToday = () => new Date().toISOString().slice(0, 10);

/** How many days back the collector will go. Cloudflare answers zero past about a month rather
 *  than answering no, and a zero written over a real figure turns a missing answer into a wrong
 *  one, so nothing older than this is ever asked for: those days are the store's. */
const LIVE_DAYS = 30;

/** Days refreshed on every daily run whether or not they are already held. Yesterday is whole by
 *  now; the two before it catch a run that was missed, or one that landed while Cloudflare was
 *  still settling the day. */
const CRON_REFRESH = 3;

/** The most days one cron run will collect. The first run has thirty to fetch and each is its own
 *  set of requests; after that it is CRON_REFRESH plus whatever was missed. Capped so a store that
 *  has been away for a month does not try to do it all in one invocation. */
const CRON_MAX_DAYS = 31;

/** And the most a read will collect, which is far lower, because somebody is waiting on it.
 *
 *  A day is its own set of requests to Cloudflare, so a cold store asked for thirty days would
 *  make two hundred of them with a reader watching a spinner. The cron is what fills a store;
 *  a read tops up today and takes a few of the gaps with it. A store still filling says so on the
 *  screen (`held` against `asked`), which is a better answer than a slow one. */
const READ_BACKFILL_MAX = 6;

/** The window read out of the store, as the tab reads it.
 *
 *  `hours` are the real instants inside the window, which is what the browser folds into days on
 *  the reader's own clock. `byDay` is those same hours added up per UTC date, which is what a
 *  single day view sums and what the fallback chart draws.
 *
 *  The categorical panels are **whole UTC days**, and only the days the window mostly covers. A
 *  local day overlaps two UTC days, twenty hours of one and four of the next, and counting both
 *  would report half again as many visits as the day had while counting neither would report
 *  none. The day that the window covers most of is the day it is about; the screen says these
 *  panels are UTC days so nobody has to work that out from the numbers. */
function storeWindow(months, sinceISO, untilISO) {
  const since = new Date(sinceISO).getTime();
  const until = new Date(untilISO).getTime();
  const dates = datesBetween(dayOf(sinceISO), dayOf(untilISO));
  const hours = [];
  const byDay = [];
  const dims = { p: new Map(), d: new Map(), b: new Map(), o: new Map(), r: new Map() };
  const dimDates = [];
  let held = 0;

  for (const date of dates) {
    const rec = months?.get(date.slice(0, 7))?.[date];
    if (!rec) continue;
    held += 1;
    let visits = 0;
    let views = 0;
    let inside = 0;
    for (let h = 0; h < 24; h += 1) {
      const at = Date.parse(`${date}T${String(h).padStart(2, '0')}:00:00Z`);
      if (at < since || at > until) continue;
      inside += 1;
      const v = rec.v?.[h] || 0;
      const w = rec.w?.[h] || 0;
      if (!v && !w) continue;
      hours.push({ key: `${date}T${String(h).padStart(2, '0')}:00:00Z`, visits: v, views: w });
      visits += v;
      views += w;
    }
    if (visits || views) byDay.push({ date, visits, views });
    // Half the day or more inside the window is the day the window is about. See above.
    if (inside >= 12) {
      dimDates.push(date);
      for (const [key, into] of Object.entries(dims)) {
        for (const [name, pair] of Object.entries(rec[key] || {})) {
          const at = into.get(name) || [0, 0];
          into.set(name, [at[0] + pair[0], at[1] + pair[1]]);
        }
      }
    }
  }

  const rowsOf = (m, limit) => [...m]
    .map(([key, [visits, views]]) => ({ key, visits, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);

  return {
    held,
    hours,
    byDay,
    dimDates,
    byPage: rowsOf(dims.p, 40).map((r) => ({ path: r.key, visits: r.visits, views: r.views })),
    groups: {
      hour: { rows: hours },
      day: { rows: byDay.map((d) => ({ key: d.date, visits: d.visits, views: d.views })) },
      page: { rows: rowsOf(dims.p, 40) },
      device: { rows: rowsOf(dims.d, 10) },
      browser: { rows: rowsOf(dims.b, 10) },
      os: { rows: rowsOf(dims.o, 10) },
      referer: { rows: rowsOf(dims.r, 15) },
    },
  };
}

/** Ask Cloudflare about a range and shape the answer. Shared by the request handler and by the
 *  daily cron, which is the whole reason it is a function rather than the body of `fetch`. */
async function gather(env, days, range = null) {
  const { since, until } = range || dayRange(days);
  const account = await accountFor(env);
  const siteTag = await siteTagFor(env, account);

  // Which site, said whichever way is available. Both name one site; the tag is the more
  // exact of the two, and the host is what is left when the tag cannot be read.
  const narrowedBy = siteTag ? 'siteTag' : 'requestHost';
  const where = siteTag
    ? `siteTag: ${JSON.stringify(siteTag)}`
    : `requestHost: ${JSON.stringify(SITE_HOST)}`;
  /* Remembered for the store path, which answers without asking Cloudflare anything and so has
     no answer of its own to read these off. They say which of the two ways the site was named,
     and an answer of zero and a wrong question look identical without them (see siteTagFor). */
  lastNarrowedBy = narrowedBy;
  lastSite = siteTag || SITE_HOST;

  // All of them at once. Separate requests so one bad dimension name costs one panel, but
  // sent together so the reader waits for the slowest rather than for the sum.
  const answered = await Promise.all(
    GROUPS.map((g) => askGroup(env, account, where, since, until, g)),
  );
  const groups = Object.fromEntries(GROUPS.map((g, i) => [g.key, answered[i]]));

  return {
    days,
    since,
    until,
    // Handed back so a zero can be told apart from a zero. An answer of "no visits" is the
    // same shape whether nobody came or the query asked about the wrong site, and the wrong
    // site is what happened once already (see siteTagFor). Not a secret: it names a site.
    narrowedBy,
    site: siteTag || SITE_HOST,
    /* Which dimension name each panel settled on. Handed back so the screen can show it, and
       so the names that actually worked can be read off once and written into GROUPS in front
       of the guesses, rather than being rediscovered by probing on every cold isolate. */
    dims: Object.fromEntries([...settledDim]),
    // Kept in the shape the tab already reads, since these two are its spine.
    byDay: (groups.byDay.rows || []).map((r) => ({ date: r.key, views: r.views, visits: r.visits })),
    byPage: (groups.byPage.rows || []).map((r) => ({ path: r.key, views: r.views, visits: r.visits })),
    // The rest as they came, each still carrying its own error where it has one.
    groups: {
      day: groups.byDay,
      page: groups.byPage,
      device: groups.byDevice,
      hour: groups.byHour,
      referer: groups.byReferer,
      browser: groups.byBrowser,
      os: groups.byOS,
    },
    fetchedAt: new Date().toISOString(),
  };
}

export default {
  /** The collection, once a day.
   *
   *  Every day Cloudflare still has that the store has not got, plus the last few whether or not
   *  it has them: yesterday is whole by now, and the two before it catch a run that was missed or
   *  one that landed while the day was still settling. On a store that has never been written
   *  that is the whole thirty days Cloudflare keeps, which is the most history there will ever be
   *  to start from; after that it is three days and whatever was missed.
   *
   *  One whole UTC day at a time, because a day is the only range whose pages and devices can
   *  honestly be filed against a date, and because the store is keyed by day.
   *
   *  Set it up under the Worker's Settings, Triggers, Cron Triggers: `0 6 * * *` is a little after
   *  1am in Lakewood, which is a quiet hour and safely inside the finished UTC day. **Without the
   *  cron the store still fills**, since opening the tab collects today and backfills what is
   *  missing, but only for the days somebody happened to be looking. */
  async scheduled(event, env, ctx) {
    if (!env.ARCHIVE || !env.CF_API_TOKEN) return;
    ctx.waitUntil(collect(env, CRON_MAX_DAYS));
  },

  async fetch(request, env, ctx) {
    const origin = allowedOrigin(request);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'GET') {
      return json({ error: 'GET only' }, 405, origin);
    }
    if (!origin) {
      return json({ error: 'Not a caller this Worker answers.' }, 403, origin);
    }
    if (!env.CF_API_TOKEN) {
      return json({ error: 'CF_API_TOKEN is not set on this Worker. It is the only setting this '
        + 'needs: add it under Settings, Variables and Secrets, as a Secret, and deploy.' }, 500, origin);
    }

    const url = new URL(request.url);
    const asked = Number(url.searchParams.get('days'));
    const days = Number.isFinite(asked) && asked >= 1 ? Math.min(Math.round(asked), MAX_DAYS) : 30;
    const span = askedWindow(url.searchParams);
    if (span?.error) return json({ error: span.error }, 400, origin);
    const wanted = span || dayRange(days);

    // Cached on the question asked rather than on the whole URL, so two tabs asking the same
    // thing share one answer and a stray parameter cannot slip past the cache. The window is
    // part of the question, so it is part of the key.
    const key = new Request(`${url.origin}/traffic?v=${BUILD}&days=${days}`
      + (span ? `&since=${encodeURIComponent(span.since)}&until=${encodeURIComponent(span.until)}` : ''),
      { method: 'GET' });
    const cache = caches.default;
    const hit = await cache.match(key);
    if (hit) {
      const body = await hit.json();
      return json({ ...body, cached: true }, 200, origin);
    }

    let out;
    try {
      out = env.ARCHIVE
        ? await fromStore(env, wanted, days)
        : await liveOnly(env, wanted, days);
    } catch (e) {
      return json({ error: e.message }, 502, origin);
    }

    out.days = days;
    out.since = wanted.since;
    out.until = wanted.until;
    /* Said out loud so the admin can tell a Worker that understood the window from one that did
       not. An older deploy ignores since and until and answers about its own range instead, which
       is a wrong answer wearing the shape of a right one: the screen checks for this and says the
       Worker needs deploying rather than drawing another day's numbers under today's date. */
    out.window = span ? 'exact' : 'days';

    const reply = json(out, 200, origin);
    // The copy goes in the cache after the reply has gone back, which is what waitUntil is for.
    ctx.waitUntil(cache.put(key, reply.clone()));
    return reply;
  },
};

/** Days collected into the store, newest first, and what was done said out loud.
 *
 *  Never throws: a collection that could not finish is a store with a gap in it, which the next
 *  run fills while Cloudflare still holds the day, and a reader waiting on this should not be
 *  handed an error because a day three weeks back would not come. */
async function collect(env, cap, { force = [] } = {}) {
  const today = utcToday();
  const wantDates = datesBetween(
    new Date(Date.parse(`${today}T00:00:00Z`) - (LIVE_DAYS - 1) * 86400000).toISOString().slice(0, 10),
    today,
  );
  const months = await readMonths(env, monthsBetween(wantDates[0], today));
  const forced = new Set(force);
  // The last few days always, because they may have changed since they were stored.
  for (let i = 0; i < CRON_REFRESH; i += 1) {
    const d = wantDates[wantDates.length - 1 - i];
    if (d) forced.add(d);
  }
  const todo = wantDates
    .filter((d) => forced.has(d) || !months?.get(d.slice(0, 7))?.[d])
    .slice(-cap)
    .reverse();

  const done = new Map();
  const failed = [];
  /* Three at a time. Each day is its own set of requests to Cloudflare and a first run has thirty
     days to fetch, so all at once is a burst this has no reason to make, and one at a time is a
     cron run that outlives its patience. */
  for (let i = 0; i < todo.length; i += 3) {
    const batch = todo.slice(i, i + 3);
    const got = await Promise.all(batch.map(async (date) => {
      try {
        return [date, await collectDay(env, date)];
      } catch (e) {
        failed.push(`${date}: ${e.message}`);
        return null;
      }
    }));
    for (const g of got) if (g) done.set(g[0], g[1]);
  }
  await writeDays(env, done);
  return { collected: [...done.keys()], failed };
}

/** The answer, out of the store, with today brought up to date first.
 *
 *  **Today is the only day the read path collects**, which is the whole of what the shul asked
 *  for: everything else is already in the store by the time anybody looks, so a range button is
 *  arithmetic on numbers this Worker already holds rather than a fresh question to Cloudflare
 *  that could be answered on a different footing from the button beside it.
 *
 *  Two exceptions, both of them about a store that has not been filled yet rather than about
 *  reading. A window with no day of it held at all collects what it can of itself, so the first
 *  ever opening of the tab is numbers and not an empty screen; and a window inside the month
 *  Cloudflare keeps that is missing days collects those, so a store that has been away catches up
 *  as it is read as well as on the cron. Both are capped, and both are skipped once the store is
 *  whole, which is the ordinary case. */
async function fromStore(env, wanted, days) {
  const today = utcToday();
  const touches = (d) => dayOf(wanted.since) <= d && d <= dayOf(wanted.until);

  const want = datesBetween(dayOf(wanted.since), dayOf(wanted.until));
  const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - (LIVE_DAYS - 1) * 86400000)
    .toISOString().slice(0, 10);
  let months = await readMonths(env, monthsBetween(want[0], want[want.length - 1]));
  const missing = want.filter((d) => d >= oldest && !months?.get(d.slice(0, 7))?.[d]);

  const force = touches(today) ? [today] : [];
  if (force.length || missing.length) {
    await collect(env, Math.min(READ_BACKFILL_MAX, missing.length) + force.length, { force });
    months = await readMonths(env, monthsBetween(want[0], want[want.length - 1]));
  }

  /* A namespace that is bound and will not read is not a store that is off: the difference is
     between nothing being kept and something being kept and unreachable, and only one of those is
     fixed by waiting. Said apart so the screen can say which. */
  if (!months) return { ...(await liveOnly(env, wanted, days)), archive: 'unreadable' };

  const win = storeWindow(months, wanted.since, wanted.until);
  const index = await readIndex(env);
  return {
    narrowedBy: lastNarrowedBy || 'requestHost',
    site: lastSite || SITE_HOST,
    dims: Object.fromEntries([...settledDim]),
    byDay: win.byDay,
    byPage: win.byPage,
    groups: win.groups,
    archive: 'on',
    archiveDays: index?.days || win.held,
    /* What the record covers and when it was last added to. A store that has stopped being
       collected into does not look broken, it looks like a quiet week, and only the time it was
       last written tells those apart. The screen prints it. */
    store: {
      from: index?.from || null,
      to: index?.to || null,
      days: index?.days || 0,
      filledAt: index?.at || null,
      held: win.held,
      asked: want.length,
      dimDays: win.dimDates.length,
    },
    fetchedAt: new Date().toISOString(),
  };
}

/** The old way, for a Worker deployed without a namespace bound.
 *
 *  Kept rather than made a requirement, because a Worker that refuses to run until somebody has
 *  created a KV namespace is a Worker that gets half deployed, and a half deployed one is how the
 *  numbers went missing for a day the last time. It behaves as this always did: Cloudflare asked
 *  about the window, every panel the range's own. The screen says the store is off. */
async function liveOnly(env, wanted, days) {
  const out = await gather(env, days, wanted);
  if (out.groups.day.error && out.groups.page.error) throw new Error(out.groups.day.error);
  out.archive = 'off';
  return out;
}
