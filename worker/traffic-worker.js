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
 *   3. On the Worker: Settings, Variables.
 *        CF_API_TOKEN   the token from step 1, as a SECRET (encrypted, write only)
 *        CF_ACCOUNT_ID  the account id out of any dashboard URL, a plain variable
 *        CF_SITE_TAG    the Web Analytics site tag, a plain variable. It is the same value
 *                       as the beacon token in the site's head, which is public.
 *      Neither of the last two is a secret; only the first one is.
 *   4. Give the Worker's address to whoever is editing the admin, and it goes in
 *      TRAFFIC_API in js/ui/traffic-view.js.
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
    for (const name of ['CF_API_TOKEN', 'CF_ACCOUNT_ID', 'CF_SITE_TAG']) {
      if (!env[name]) {
        return json({ error: `${name} is not set on this Worker. See the note at the top of traffic-worker.js.` }, 500, origin);
      }
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
          variables: { accountTag: env.CF_ACCOUNT_ID, siteTag: env.CF_SITE_TAG, since, until },
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

    const account = body?.data?.viewer?.accounts?.[0];
    if (!account) {
      return json({ error: 'Cloudflare returned no account. Is CF_ACCOUNT_ID right?', detail: body }, 502, origin);
    }

    const out = {
      days,
      since,
      until,
      byDay: (account.byDay || []).map((g) => ({
        date: g.dimensions.date,
        views: g.count,
        visits: g.sum?.visits ?? 0,
      })),
      byPage: (account.byPage || []).map((g) => ({
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
