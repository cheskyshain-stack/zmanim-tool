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
 *      That is the whole of it. It is the only value here that has to be kept, so it is the
 *      only one asked for.
 *   4. Give the Worker's address to whoever is editing the admin, and it goes in
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
const BUILD = '2026-09-11b';

/** The most days that can be asked for at once, so a mistyped range cannot ask for something
 *  absurd. Cloudflare itself is never asked past LIVE_DAYS; everything beyond that is the
 *  archive's, which is why this is years rather than a month. */
const MAX_DAYS = 800;

/** The beacon token, out of the congregation site's own head. Public by construction, since
 *  every visitor's browser is handed it. See ANALYTICS_TOKEN in build-offline.py. */
const SITE_TOKEN = 'e96217102b81416db30f31a0c105fece';

/** The host the congregation's pages are served from. The other way of saying which site, used
 *  where the site tag cannot be had. Same value as SITE_URL's host in build-offline.py. */
const SITE_HOST = 'lczmanim.cjaffa.com';

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
function dayRange(days) {
  const until = new Date();
  const since = new Date(until.getTime() - (days - 1) * 86400000);
  since.setUTCHours(0, 0, 0, 0);
  return { since: since.toISOString(), until: until.toISOString() };
}

/* ── Keeping the numbers after Cloudflare has forgotten them ───────────────────────────────
 *
 * Cloudflare's free Web Analytics keeps about a month. Ask it for last Pesach and it does not
 * say no, it says zero, which is the same shape as an answer. So the shul's own record of its
 * own numbers is kept here instead, in a KV namespace on this Worker, and grows for as long as
 * the Worker runs.
 *
 * **The binding is optional and everything works without it.** With no ARCHIVE bound this
 * behaves exactly as it did, and the reply says so rather than silently keeping nothing. That
 * matters because the alternative is a Worker that cannot be deployed until a namespace exists,
 * and a half-deployed Worker is how the numbers went missing for a day the last time.
 *
 * What is kept is one entry, a map of UTC date to two arrays of 24 hours, visits and page views,
 * plus that day's pages, devices, systems and referrers. Hours rather than day totals, because
 * the screen folds them back into Lakewood days and that fold needs the hour (see the UTC note
 * in CLAUDE.md). A year of it is on the order of a hundred kilobytes, well inside what KV holds
 * in one value, and one value means one read to answer any range rather than one read a day.
 *
 * Cloudflare stays the authority for the days it still has: they are written over the archive on
 * every read, so a day that was still filling in when it was first stored is corrected rather
 * than frozen half done.
 *
 * Two writers can race, the daily cron and somebody opening the tab, and the loser's day is
 * dropped. It comes back on the next write, because Cloudflare still has the last month to
 * rebuild it from. Worth knowing, not worth a lock. */
const ARCHIVE_KEY = 'days';

/** How far back Cloudflare itself is asked. Beyond this it answers zero rather than answering
 *  no, so asking is worse than not asking: the archive holds those days and a live zero written
 *  over a real figure would be a wrong answer rather than a missing one. */
const LIVE_DAYS = 30;

const dayOf = (iso) => String(iso).slice(0, 10);
const hourOf = (iso) => Number(String(iso).slice(11, 13));

async function readArchive(env) {
  if (!env.ARCHIVE) return null;
  try {
    return (await env.ARCHIVE.get(ARCHIVE_KEY, 'json')) || {};
  } catch {
    return null;
  }
}

/** Fold a day's live answer into the archive, whole days only.
 *
 *  Today is stored too, and stored again on the next read, because a day still happening is a
 *  day whose figures still move. Nothing is deleted: the point of this is the years Cloudflare
 *  will not keep. */
function foldIntoArchive(store, out) {
  const touched = new Set();
  const dayEntry = (date) => {
    touched.add(date);
    if (!store[date]) store[date] = { v: new Array(24).fill(0), w: new Array(24).fill(0) };
    return store[date];
  };

  /* Built from the hourly grouping and only from it. A day total with no hours in it cannot be
     folded back into a Lakewood day later, so storing one would be storing something that reads
     as history and answers the wrong question forever after. If the hour grouping is ever
     refused, the archive stops growing and the screen says the range it can show; that is the
     honest failure. */
  // Every day the live answer covers is rebuilt from scratch, so a correction replaces rather
  // than adds to what was stored while the day was still filling up.
  for (const r of out.groups.hour.rows || []) {
    const d = dayEntry(dayOf(r.key));
    if (!d.cleared) { d.v = new Array(24).fill(0); d.w = new Array(24).fill(0); d.cleared = true; }
  }
  for (const r of out.groups.hour.rows || []) {
    const d = store[dayOf(r.key)];
    const h = hourOf(r.key);
    if (!d || !(h >= 0 && h < 24)) continue;
    d.v[h] += r.visits;
    d.w[h] += r.views;
  }
  for (const date of touched) delete store[date].cleared;

  /* The categorical breakdowns are kept per day as well, so a year-old month can still say which
     pages were opened and what people read it on. They come back from Cloudflare for the whole
     range at once rather than per day, so they can only be stored against the range's last whole
     day: split evenly they would be invented, and attached to every day they would be counted
     over and over. One day carrying the range's totals is a lie of a different shape, so what is
     stored is only ever a single-day range, which is what the cron asks for. */
  if (out.days === 1) {
    const only = dayOf(out.since);
    if (store[only]) {
      const put = (key, rows) => {
        if (!rows) return;
        store[only][key] = Object.fromEntries(rows.map((r) => [r.key || '(none)', [r.visits, r.views]]));
      };
      put('p', out.groups.page?.rows);
      put('d', out.groups.device?.rows);
      put('o', out.groups.os?.rows);
      put('r', out.groups.referer?.rows);
    }
  }
  return store;
}

async function writeArchive(env, store) {
  if (!env.ARCHIVE || !store) return;
  try {
    await env.ARCHIVE.put(ARCHIVE_KEY, JSON.stringify(store));
  } catch {
    // A archive that will not write is a screen with less history on it, not a broken screen.
  }
}

/** The archive's own hour rows and day rows for a range, in the shape a live answer has. */
function archiveRows(store, sinceISO, untilISO) {
  const from = dayOf(sinceISO);
  const to = dayOf(untilISO);
  const hours = [];
  const byDay = [];
  for (const date of Object.keys(store).sort()) {
    if (date < from || date > to) continue;
    const day = store[date];
    let visits = 0;
    let views = 0;
    for (let h = 0; h < 24; h += 1) {
      const v = day.v?.[h] || 0;
      const w = day.w?.[h] || 0;
      if (!v && !w) continue;
      hours.push({ key: `${date}T${String(h).padStart(2, '0')}:00:00Z`, visits: v, views: w });
      visits += v;
      views += w;
    }
    if (visits || views) byDay.push({ date, visits, views });
  }
  return { hours, byDay };
}

/** The live answer laid over the archive, keyed so Cloudflare wins wherever it has something.
 *
 *  Cloudflare is the authority for the month it keeps: a day it can still see is a day it can
 *  see more accurately than a copy taken while that day was still happening. Everything older is
 *  the archive's, which is the whole point of having one. */
function overlay(archived, live, keyOf) {
  const at = new Map(archived.map((r) => [keyOf(r), r]));
  for (const r of live) at.set(keyOf(r), r);
  return [...at.values()].sort((a, b) => String(keyOf(a)).localeCompare(String(keyOf(b))));
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
  /** Once a day, so the archive grows whether or not anybody opened the admin.
   *
   *  Without this the record would have holes in exactly the stretches nobody was looking, which
   *  are the stretches a record is for. One day at a time, because a single-day range is the only
   *  one whose pages and devices can honestly be filed against a date (see foldIntoArchive).
   *
   *  Set it up under the Worker's Settings, Triggers, Cron Triggers: `0 6 * * *` is a little
   *  after 1am in Lakewood, which is a quiet hour and safely inside the finished day. Optional,
   *  like the namespace: without it the archive still grows every time the tab is opened. */
  async scheduled(event, env, ctx) {
    if (!env.ARCHIVE || !env.CF_API_TOKEN) return;
    ctx.waitUntil((async () => {
      try {
        const store = (await readArchive(env)) || {};
        // Yesterday and the day before: yesterday is whole by now, and the day before catches a
        // run that was missed or that landed while the day was still being written. One whole
        // UTC day at a time, so the pages and devices that come back belong to the day they are
        // filed under rather than to a range straddling two.
        for (const back of [1, 2]) {
          const at = new Date(Date.now() - back * 86400000);
          const from = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
          const to = new Date(from.getTime() + 86400000 - 1);
          const out = await gather(env, 1, { since: from.toISOString(), until: to.toISOString() });
          foldIntoArchive(store, out);
        }
        await writeArchive(env, store);
      } catch {
        // A cron that could not run is a gap the next read fills, since Cloudflare still holds
        // the month. Nothing here is worth failing loudly at 1am.
      }
    })());
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

    // Cached on the range asked for rather than on the whole URL, so two tabs asking the
    // same question share one answer and a stray parameter cannot slip past the cache.
    const key = new Request(`${url.origin}/traffic?v=${BUILD}&days=${days}`, { method: 'GET' });
    const cache = caches.default;
    const hit = await cache.match(key);
    if (hit) {
      const body = await hit.json();
      return json({ ...body, cached: true }, 200, origin);
    }

    /* Cloudflare is only asked about the month it actually keeps. Past that it answers zero
       rather than answering no, and a live zero written over a real figure in the archive would
       turn a missing answer into a wrong one. The older days come from the archive. */
    let out;
    try {
      out = await gather(env, Math.min(days, LIVE_DAYS));
    } catch (e) {
      return json({ error: e.message }, 502, origin);
    }

    /* The day and page groupings are the tab itself rather than a panel on it, so if both of
       them failed there is nothing to show and this is an error, not a screen with holes in it.
       One of the two failing is still worth drawing: the other panels stand on their own. */
    if (out.groups.day.error && out.groups.page.error) {
      return json({ error: out.groups.day.error }, 502, origin);
    }

    // What was asked for, not what Cloudflare was asked for, since the archive covers the rest.
    const wanted = dayRange(days);
    out.days = days;
    out.since = wanted.since;

    const store = await readArchive(env);
    out.archive = env.ARCHIVE ? (store ? 'on' : 'unreadable') : 'off';
    if (store) {
      const older = archiveRows(store, wanted.since, wanted.until);
      out.byDay = overlay(older.byDay, out.byDay, (r) => r.date);
      if (out.groups.hour.rows) {
        out.groups.hour = { ...out.groups.hour, rows: overlay(older.hours, out.groups.hour.rows, (r) => r.key) };
      } else if (older.hours.length) {
        out.groups.hour = { rows: older.hours };
      }
      out.archiveDays = Object.keys(store).length;
      // Written back after the reply is built, so the reader is not kept waiting on a store.
      ctx.waitUntil(writeArchive(env, foldIntoArchive(store, out)));
    }

    const reply = json(out, 200, origin);
    // The copy goes in the cache after the reply has gone back, which is what waitUntil is for.
    // An earlier comment here claimed it was not available on a fetch handler. It is: a module
    // Worker's fetch takes (request, env, ctx), and ctx is where it lives.
    ctx.waitUntil(cache.put(key, reply.clone()));
    return reply;
  },
};
