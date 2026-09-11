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
 *  Five minutes. The numbers are visits over days and nobody is watching them tick; the
 *  point is that the tab can be opened and reopened, and left open on a desk, without
 *  spending the account's API allowance on a figure that has not moved. */
const CACHE_SECONDS = 300;

/** The most days that can be asked for at once, so a mistyped range cannot ask Cloudflare
 *  for a year of buckets. Web Analytics keeps less than this anyway on the free plan. */
const MAX_DAYS = 90;

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

export default {
  async fetch(request, env) {
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
    const key = new Request(`${url.origin}/traffic?days=${days}`, { method: 'GET' });
    const cache = caches.default;
    const hit = await cache.match(key);
    if (hit) {
      const body = await hit.json();
      return json({ ...body, cached: true }, 200, origin);
    }

    const { since, until } = dayRange(days);
    let account;
    let siteTag;
    try {
      account = await accountFor(env);
      siteTag = await siteTagFor(env, account);
    } catch (e) {
      return json({ error: e.message }, 502, origin);
    }

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

    /* The day and page groupings are the tab itself rather than a panel on it, so if both of
       them failed there is nothing to show and this is an error, not a screen with holes in it.
       One of the two failing is still worth drawing: the other panels stand on their own. */
    if (groups.byDay.error && groups.byPage.error) {
      return json({ error: groups.byDay.error }, 502, origin);
    }

    const out = {
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
        device: groups.byDevice,
        hour: groups.byHour,
        referer: groups.byReferer,
        browser: groups.byBrowser,
        os: groups.byOS,
      },
      fetchedAt: new Date().toISOString(),
    };
    const reply = json(out, 200, origin);
    // waitUntil is not available on a plain fetch handler's arguments here, so the copy is
    // put in the cache before the reply goes back. It is a small body and the write is local
    // to the edge that is already answering.
    await cache.put(key, reply.clone());
    return reply;
  },
};
