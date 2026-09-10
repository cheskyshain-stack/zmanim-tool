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
 * with no secrecy to justify it. The site tag is the beacon token out of the site's own head,
 * which every visitor can read, so it is written below. The account id is something the token
 * itself can be asked for, so the Worker asks. Both can still be overridden by a variable of
 * the same name, which is what an account holding more than one Cloudflare account needs.
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

/** Which site's numbers. This is the Web Analytics site tag, and it is the same string as the
 *  beacon token in the congregation site's head: public by construction, since every visitor's
 *  browser is handed it. Written here rather than asked for as a variable, because a value
 *  anybody can read off the page is not worth a setup step. CF_SITE_TAG overrides it. */
const SITE_TAG = 'e96217102b81416db30f31a0c105fece';

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
    throw new Error('This token can see no account. It needs Account, Account Analytics, Read.');
  }
  if (list.length > 1) {
    throw new Error('This token can see more than one account, so CF_ACCOUNT_ID has to say which: '
      + list.map((a) => `${a.name} = ${a.id}`).join(', '));
  }
  knownAccount = list[0].id;
  return knownAccount;
}

/* The query.
 *
 * rumPageloadEventsAdaptiveGroups is Cloudflare's own Web Analytics dataset: one group per
 * bucket, `count` being page views and `sum { visits }` being visits, which is the pair the
 * dashboard shows. Asked for twice over the same range, grouped two ways: by day, which is
 * the chart, and by path, which is what people actually opened.
 *
 * Both are filtered to this one site by siteTag, because an account can hold several. */
const QUERY = `
query Traffic($accountTag: string!, $siteTag: string!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      byDay: rumPageloadEventsAdaptiveGroups(
        limit: 100
        filter: { siteTag: $siteTag, datetime_geq: $since, datetime_leq: $until }
        orderBy: [date_ASC]
      ) {
        count
        sum { visits }
        dimensions { date }
      }
      byPage: rumPageloadEventsAdaptiveGroups(
        limit: 25
        filter: { siteTag: $siteTag, datetime_geq: $since, datetime_leq: $until }
        orderBy: [count_DESC]
      ) {
        count
        sum { visits }
        dimensions { requestPath }
      }
    }
  }
}`;

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

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${CACHE_SECONDS}`,
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
    try {
      account = await accountFor(env);
    } catch (e) {
      return json({ error: e.message }, 502, origin);
    }

    let res;
    let body;
    try {
      res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.CF_API_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: QUERY,
          variables: { accountTag: account, siteTag: env.CF_SITE_TAG || SITE_TAG, since, until },
        }),
      });
      body = await res.json();
    } catch (e) {
      return json({ error: `Could not reach Cloudflare: ${e.message}` }, 502, origin);
    }

    // Handed on as they are, because the admin can say more with the real message than with
    // anything this could put in its place.
    if (!res.ok) {
      return json({ error: `Cloudflare answered ${res.status}`, detail: body }, 502, origin);
    }
    if (body.errors && body.errors.length) {
      return json({ error: body.errors.map((e) => e.message).join('; '), detail: body.errors }, 502, origin);
    }

    const found = body?.data?.viewer?.accounts?.[0];
    if (!found) {
      return json({ error: `Cloudflare returned nothing for account ${account}.`, detail: body }, 502, origin);
    }

    const out = {
      days,
      since,
      until,
      byDay: (found.byDay || []).map((g) => ({
        date: g.dimensions.date,
        views: g.count,
        visits: g.sum?.visits ?? 0,
      })),
      byPage: (found.byPage || []).map((g) => ({
        path: g.dimensions.requestPath,
        views: g.count,
        visits: g.sum?.visits ?? 0,
      })),
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
