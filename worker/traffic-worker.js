/* Aggregate Web Analytics for the shul. This endpoint intentionally remains public
 * to the allowed browser origins. API credentials stay in CF_API_TOKEN, never in
 * the response. CF_ACCOUNT_ID and CF_SITE_TAG are optional identity overrides.
 *
 * Bind ARCHIVE to preserve completed UTC days. Existing m:YYYY-MM records remain
 * readable; v2 d2:YYYY-MM-DD records also preserve each category's UTC hour, so
 * every New York date window uses precisely the same events in every panel.
 * Deploy with Wrangler so the calendar helper is bundled. Existing cron triggers
 * 0 4,5 * * * remain supported; collection runs at New York midnight only.
 */
import { TIMEZONE, HOUR, DAY, MAX_DAYS, civilDate, shiftDate, datesBetween, midnight, requestedRange } from './traffic-calendar.js';

const ALLOWED = [
  'https://baismedrashoflakewoodcommons.org', 'https://lczmanim.cjaffa.com',
  'http://localhost', 'http://127.0.0.1',
];
const SITE_HOST = 'baismedrashoflakewoodcommons.org';
const SITE_TOKEN = 'e96217102b81416db30f31a0c105fece';
// Public source identifiers for the pre-v2 archive, whose records did not carry
// their own identity. An override must never silently import that other source.
const LEGACY_ACCOUNT = '04b085d9f19ac1ba6d333e0006fc94c1';
const LEGACY_SITE_TAG = 'abd00a69157843b2bb7275c8a265d88f';
const BUILD = '2026-10-01-stats-v2b';
const CACHE_SECONDS = 45;
const ROW_LIMIT = 10000;
const READ_REPAIR_DAYS = 5;
const CRON_REFRESH_DAYS = 3;
const GROUPS = [
  { key: 'hour', dims: ['datetimeHour'], hourly: true },
  { key: 'page', dims: ['requestPath'] },
  { key: 'device', dims: ['deviceType'] },
  { key: 'browser', dims: ['userAgentBrowser', 'browser'] },
  { key: 'os', dims: ['userAgentOS', 'os', 'operatingSystem'] },
  { key: 'referer', dims: ['refererHost', 'refererDomain', 'referer'] },
];
const RECORD_KEYS = { page: 'p', device: 'd', browser: 'b', os: 'o', referer: 'r' };
const settledDimensions = new Map();
const accountCache = new Map();
const siteCache = new Map();
const collectingDays = new Map();
const sourceCooldowns = new Map();
const lastKnownDays = new Map();
const RATE_LIMIT_COOLDOWN_MS = 5 * 60000;
const REQUEST_TIMEOUT_MS = 10000;
// Cache API calls share the free plan's 50-subrequest quota with fetch. Reserve
// two calls for the outer response cache; collection fetch/cache work fits 48.
const MAX_COLLECTION_REQUESTS = 48;
const isoDate = (at) => new Date(at).toISOString().slice(0, 10);
const dateStart = (date) => Date.parse(`${date}T00:00:00Z`);
const nonnegative = (n) => Number.isFinite(n) && n >= 0;
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
const sourceIdentity = (source) => ({ account: source.account, site: source.site, narrowedBy: source.narrowedBy });
const sourceKey = (source) => `${source.account}/${source.narrowedBy}/${source.site}`;
const sameSource = (left, right) => !!left && left.account === right.account
  && left.site === right.site && left.narrowedBy === right.narrowedBy;
const legacyMatches = (source) => source.account === LEGACY_ACCOUNT
  && ((source.narrowedBy === 'siteTag' && source.site === LEGACY_SITE_TAG)
    || (source.narrowedBy === 'requestHost' && source.site === SITE_HOST));
function cooldown(source) {
  const until = sourceCooldowns.get(sourceKey(source));
  if (!until || until <= Date.now()) {
    sourceCooldowns.delete(sourceKey(source));
    return null;
  }
  return { cooldownUntil: new Date(until).toISOString(), retryAfterSeconds: Math.ceil((until - Date.now()) / 1000),
    error: `Cloudflare temporarily rate-limited analytics collection. Collection is paused until ${new Date(until).toISOString()}. Existing recorded data is kept; refreshing before then will not retry Cloudflare.` };
}
function beginCooldown(source) {
  const key = sourceKey(source);
  sourceCooldowns.set(key, Math.max(sourceCooldowns.get(key) || 0, Date.now() + RATE_LIMIT_COOLDOWN_MS));
  return cooldown(source);
}
function rememberDay(source, date, record) {
  const key = `${sourceKey(source)}/${date}`;
  const previous = lastKnownDays.get(key);
  if (!previous || recordUntil(record, date) >= recordUntil(previous, date)) lastKnownDays.set(key, record);
  // Short-lived Worker memory is a fallback during throttling, not the archive.
  while (lastKnownDays.size > 128) lastKnownDays.delete(lastKnownDays.keys().next().value);
}
function keepLastKnown(records, source, dates) {
  for (const date of dates) {
    const remembered = lastKnownDays.get(`${sourceKey(source)}/${date}`);
    const current = records.get(date);
    if (remembered && (!current || recordUntil(remembered, date) > recordUntil(current, date))) records.set(date, remembered);
  }
}

function allowedOrigin(request) {
  const origin = request.headers.get('Origin');
  try {
    const url = new URL(origin);
    return ALLOWED.includes(`${url.protocol}//${url.hostname}`) ? origin : null;
  } catch { return null; }
}
function cors(origin) {
  return {
    'access-control-allow-origin': origin || 'null',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400', vary: 'Origin',
  };
}
function json(body, status, origin, cacheable = false) {
  return new Response(JSON.stringify(body), { status, headers: {
    'content-type': 'application/json; charset=utf-8', ...cors(origin),
    'cache-control': cacheable ? `public, max-age=${CACHE_SECONDS}` : 'no-store',
  } });
}
function safeError(error, env) {
  let text = String(error?.message || error || 'Analytics could not be loaded.');
  if (env.CF_API_TOKEN) text = text.split(env.CF_API_TOKEN).join('[redacted]');
  return text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 700);
}
function repairDays(env) {
  // A sync budget, not a claim about provider retention. Configure only after
  // confirming the dataset's lookback limit for this account.
  const n = Number(env.CF_LOOKBACK_DAYS || 30);
  return Number.isInteger(n) && n >= 1 && n <= 180 ? n : 30;
}
async function upstreamFetch(url, init, budget) {
  if (budget.remaining <= 0) throw new Error('Analytics collection reached its request budget. The remaining dates will be collected on a later run.');
  budget.remaining -= 1;
  budget.upstreamRequests += 1;
  return fetch(url, { ...init, redirect: 'error' });
}
async function collectionCache(cache, method, key, value, budget) {
  if (!cache || budget.remaining <= 0) return null;
  budget.remaining -= 1;
  budget.cacheRequests += 1;
  return method === 'put' ? cache.put(key, value) : cache.match(key);
}
async function accountFor(env, budget) {
  if (env.CF_ACCOUNT_ID) return env.CF_ACCOUNT_ID;
  if (accountCache.has(env.CF_API_TOKEN)) return accountCache.get(env.CF_API_TOKEN);
  const response = await upstreamFetch('https://api.cloudflare.com/client/v4/accounts?per_page=50', {
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, budget);
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) throw new Error('Cloudflare account lookup failed. Check the analytics token permissions.');
  const accounts = body.result || [];
  if (accounts.length !== 1) throw new Error('Set CF_ACCOUNT_ID to the intended Cloudflare account. This token does not identify exactly one account.');
  accountCache.set(env.CF_API_TOKEN, accounts[0].id);
  return accounts[0].id;
}
async function sourceFor(env, budget) {
  const account = await accountFor(env, budget);
  if (env.CF_SITE_TAG) return { account, site: env.CF_SITE_TAG, narrowedBy: 'siteTag' };
  const key = `${account}:${env.CF_API_TOKEN}`;
  if (siteCache.has(key)) return { account, ...siteCache.get(key) };
  let tag = null;
  try {
    const response = await upstreamFetch(`https://api.cloudflare.com/client/v4/accounts/${account}/rum/site_info/list?per_page=100`, {
      headers: { authorization: `Bearer ${env.CF_API_TOKEN}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, budget);
    const body = await response.json();
    if (response.ok && body?.success) tag = (body.result || []).find((site) => site.site_token === SITE_TOKEN)?.site_tag;
  } catch { /* The read-only analytics token can still query by host. */ }
  const source = tag ? { site: tag, narrowedBy: 'siteTag' } : { site: SITE_HOST, narrowedBy: 'requestHost' };
  siteCache.set(key, source);
  return { account, ...source };
}
function queryFor(source, group, dimension) {
  return `query Traffic($accountTag: string!, $since: Time!, $until: Time!) {
    viewer { accounts(filter: { accountTag: $accountTag }) {
      rows: rumPageloadEventsAdaptiveGroups(
        limit: ${ROW_LIMIT}
        filter: { ${source.narrowedBy}: ${JSON.stringify(source.site)}, datetime_geq: $since, datetime_lt: $until }
        orderBy: [datetimeHour_ASC]
      ) { count sum { visits } dimensions { datetimeHour${group.hourly ? '' : ` ${dimension}`} } }
    } }
  }`;
}
async function askGroup(env, source, since, until, group, budget) {
  const known = settledDimensions.get(group.key);
  const dimensions = known ? [known, ...group.dims.filter((d) => d !== known)] : group.dims;
  let error = 'No supported dimension found.';
  for (const dimension of dimensions) {
    const paused = cooldown(source);
    if (paused) return paused;
    let response;
    let body;
    try {
      response = await upstreamFetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST', headers: {
          authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json',
        },
        body: JSON.stringify({ query: queryFor(source, group, dimension), variables: { accountTag: source.account, since, until } }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }, budget);
      body = await response.json().catch(() => null);
    } catch (error) { return { error: budget.remaining <= 0 ? 'Analytics collection reached its request budget. Retry or wait for the next collection.' : 'Cloudflare could not be reached.' }; }
    if (response.status === 429) return beginCooldown(source);
    if (!response.ok) return { error: `Cloudflare answered HTTP ${response.status}.` };
    if (body?.errors?.length) {
      error = safeError(body.errors.map((e) => e.message).join('; '), env);
      if (/rate[ -]?limit|rate limiter|budget depleted|too many requests/i.test(error)) return beginCooldown(source);
      if (/field|dimension|unknown|cannot query|no such/i.test(error)) continue;
      return { error };
    }
    const raw = body?.data?.viewer?.accounts?.[0]?.rows;
    if (!Array.isArray(raw)) return { error: 'Cloudflare did not return this grouping.' };
    if (raw.length >= ROW_LIMIT) return { error: 'Cloudflare reached the row limit. This grouping was not saved as complete.' };
    const rows = [];
    for (const row of raw) {
      const hour = Date.parse(row.dimensions?.datetimeHour);
      const views = row.count;
      const visits = row.sum?.visits;
      if (!nonnegative(views) || !nonnegative(visits) || !Number.isFinite(hour) || hour % HOUR
        || hour < Math.floor(Date.parse(since) / HOUR) * HOUR || hour >= Date.parse(until)) {
        return { error: 'Cloudflare returned invalid or out-of-window traffic rows.' };
      }
      rows.push({ key: group.hourly ? new Date(hour).toISOString() : String(row.dimensions?.[dimension] ?? ''),
        hour: new Date(hour).toISOString(), views, visits });
    }
    settledDimensions.set(group.key, dimension);
    return { rows, dim: dimension };
  }
  return { error };
}
async function gatherDayUncached(env, source, date, until, budget) {
  const since = new Date(dateStart(date)).toISOString();
  const results = await Promise.all(GROUPS.map((g) => askGroup(env, source, since, until, g, budget)));
  const groups = Object.fromEntries(GROUPS.map((g, i) => [g.key, results[i]]));
  if (groups.hour.error) throw new Error(groups.hour.error);
  const record = {
    version: 2, since, until, at: new Date().toISOString(),
    v: new Array(24).fill(0), w: new Array(24).fill(0), errors: {},
    source: sourceIdentity(source),
  };
  for (const row of groups.hour.rows) {
    const hour = new Date(row.hour).getUTCHours();
    record.v[hour] += row.visits;
    record.w[hour] += row.views;
  }
  for (const [name, key] of Object.entries(RECORD_KEYS)) {
    if (groups[name].error) { record.errors[name] = groups[name].error; continue; }
    const buckets = Array.from({ length: 24 }, () => Object.create(null));
    for (const row of groups[name].rows) {
      const bucket = buckets[new Date(row.hour).getUTCHours()];
      const pair = bucket[row.key] || [0, 0];
      bucket[row.key] = [pair[0] + row.visits, pair[1] + row.views];
    }
    record[key] = buckets;
  }
  return record;
}
async function gatherDay(env, source, date, until, budget) {
  // All range buttons reuse this same bounded snapshot of a source day. This
  // also deduplicates simultaneous requests without making past days mutable.
  const key = new Request(`https://traffic-collection.internal/${BUILD}/${source.account}/${source.narrowedBy}/${encodeURIComponent(source.site)}/${date}?until=${encodeURIComponent(until)}`);
  const cache = globalThis.caches?.default;
  const hit = await collectionCache(cache, 'match', key, null, budget);
  if (hit) {
    const record = await hit.json();
    if (sameSource(record.source, source)) { rememberDay(source, date, record); return record; }
  }
  if (collectingDays.has(key.url)) return collectingDays.get(key.url);
  const pending = (async () => {
    const record = await gatherDayUncached(env, source, date, until, budget);
    rememberDay(source, date, record);
    if (!Object.keys(record.errors).length && cache) {
      try { await collectionCache(cache, 'put', key, new Response(JSON.stringify(record), { headers: { 'cache-control': `public, max-age=${CACHE_SECONDS}` } }), budget); }
      catch { /* A cache is optional; an archive is checked separately. */ }
    }
    return record;
  })();
  collectingDays.set(key.url, pending);
  try { return await pending; }
  finally { collectingDays.delete(key.url); }
}
async function gatherLiveWindow(env, source, range, oldest, budget) {
  const since = new Date(Math.max(Date.parse(range.since), dateStart(oldest))).toISOString();
  const until = range.until;
  if (since >= until) return { records: new Map(), collection: { collected: [], errors: [], status: 'ok', remainingDays: 0 } };
  const paused = cooldown(source);
  if (paused) {
    const records = new Map();
    keepLastKnown(records, source, datesBetween(isoDate(since), isoDate(Date.parse(until) - 1)));
    return { records, collection: { collected: [], errors: [paused.error], status: 'degraded', remainingDays: 0,
      cooldownUntil: paused.cooldownUntil, retryAfterSeconds: paused.retryAfterSeconds } };
  }
  // No archive: six grouped queries cover the complete eligible window, rather
  // than leaving long reports stuck at the same few newest days forever.
  const results = await Promise.all(GROUPS.map((group) => askGroup(env, source, since, until, group, budget)));
  const groups = Object.fromEntries(GROUPS.map((group, index) => [group.key, results[index]]));
  if (groups.hour.error) {
    if (cooldown(source)) return gatherLiveWindow(env, source, range, oldest, budget);
    throw new Error(groups.hour.error);
  }
  const records = new Map();
  for (const date of datesBetween(isoDate(since), isoDate(Date.parse(until) - 1))) {
    const rec = { version: 2, since: new Date(Math.max(dateStart(date), Date.parse(since))).toISOString(),
      until: new Date(Math.min(dateStart(date) + DAY, Date.parse(until))).toISOString(),
      at: new Date().toISOString(), v: new Array(24).fill(0), w: new Array(24).fill(0), errors: {}, source: sourceIdentity(source) };
    for (const [name, key] of Object.entries(RECORD_KEYS)) {
      if (groups[name].error) rec.errors[name] = groups[name].error;
      else rec[key] = Array.from({ length: 24 }, () => Object.create(null));
    }
    records.set(date, rec);
  }
  for (const [name, group] of Object.entries(groups)) {
    for (const row of group.rows || []) {
      const rec = records.get(isoDate(row.hour));
      const hour = new Date(row.hour).getUTCHours();
      if (name === 'hour') { rec.v[hour] += row.visits; rec.w[hour] += row.views; }
      else {
        const bucket = rec[RECORD_KEYS[name]][hour];
        const pair = bucket[row.key] || [0, 0];
        bucket[row.key] = [pair[0] + row.visits, pair[1] + row.views];
      }
    }
  }
  const errors = Object.entries(groups).filter(([, group]) => group.error).map(([name, group]) => `${name}: ${group.error}`);
  for (const [date, record] of records) rememberDay(source, date, record);
  return { records, collection: { collected: [...records.keys()], errors, status: errors.length ? 'degraded' : 'ok', remainingDays: 0 } };
}
async function readRecords(env, dates, source) {
  if (!env.ARCHIVE) return { records: new Map(), conflicts: [], ignoredLegacy: [] };
  const records = new Map();
  const conflicts = [];
  const ignoredLegacy = [];
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))];
  const legacy = new Map(await Promise.all(months.map(async (month) => [month, await env.ARCHIVE.get(`m:${month}`, 'json') || {}])));
  for (let i = 0; i < dates.length; i += 30) {
    const got = await Promise.all(dates.slice(i, i + 30).map(async (date) => [date, await env.ARCHIVE.get(`d2:${date}`, 'json')]));
    for (const [date, record] of got) {
      if (record) {
        if (sameSource(record.source, source)) records.set(date, record);
        else conflicts.push(date);
      } else {
        const prior = legacy.get(date.slice(0, 7))?.[date];
        if (prior && legacyMatches(source)) records.set(date, prior);
        else if (prior) ignoredLegacy.push(date);
      }
    }
  }
  return { records, conflicts, ignoredLegacy };
}
function recordUntil(record, date) {
  const boundary = dateStart(date) + DAY;
  const stamped = Date.parse(record.version === 2 ? record.until : record.at);
  return Number.isFinite(stamped) ? Math.min(boundary, stamped) : dateStart(date);
}
function recordUsable(record) {
  return Array.isArray(record?.v) && Array.isArray(record?.w) && record.v.length === 24 && record.w.length === 24
    && record.v.every(nonnegative) && record.w.every(nonnegative);
}
function totalsComplete(record, date) {
  return recordUsable(record) && record.version === 2 && recordUntil(record, date) === dateStart(date) + DAY;
}
function recordComplete(record, date) {
  return totalsComplete(record, date) && !Object.keys(record.errors || {}).length
    && Object.values(RECORD_KEYS).every((key) => Array.isArray(record[key]) && record[key].length === 24);
}
function collectionOrder(records, dates, snapshotAt, force = []) {
  const snapshot = Date.parse(snapshotAt);
  const missing = dates.filter((date) => !totalsComplete(records.get(date), date)
    || recordUntil(records.get(date), date) !== Math.min(dateStart(date) + DAY, snapshot)).reverse();
  const forced = force.filter((date) => !missing.includes(date));
  const details = dates.filter((date) => !missing.includes(date) && !forced.includes(date) && !recordComplete(records.get(date), date))
    .sort((a, b) => String(records.get(a)?.at || '').localeCompare(String(records.get(b)?.at || '')) || a.localeCompare(b));
  return [...missing, ...forced, ...details];
}
async function collectDates(env, records, dates, snapshotAt, source, budget) {
  const errors = [];
  const collected = [];
  const snapshot = Date.parse(snapshotAt);
  for (const date of dates) {
    const paused = cooldown(source);
    if (paused) {
      keepLastKnown(records, source, dates);
      if (!errors.some((error) => error.includes('temporarily rate-limited'))) errors.push(paused.error);
      break;
    }
    const until = new Date(Math.min(dateStart(date) + DAY, snapshot)).toISOString();
    try {
      const record = await gatherDay(env, source, date, until, budget);
      const groupErrors = Object.entries(record.errors).map(([name, error]) => `${date} ${name}: ${error}`);
      errors.push(...groupErrors);
      const previous = records.get(date);
      if (sameSource(previous?.source, source)) {
        for (const name of Object.keys(record.errors)) {
          const key = RECORD_KEYS[name];
          const retained = previous.errors?.[name] ? previous.retainedDetails?.[name] : previous[key];
          if (retained) {
            record.retainedDetails ||= {};
            record.retainedDetails[name] = retained;
          }
        }
      }
      // Current-day snapshots are ephemeral. An earlier browser snapshot must
      // never overwrite newer numbers in the archive. Completed days get their
      // own key, so two collectors cannot drop each other's days in a month.
      if (env.ARCHIVE && totalsComplete(record, date)) {
        try {
          const current = await env.ARCHIVE.get(`d2:${date}`, 'json');
          if (current && !sameSource(current.source, source)) {
            errors.push(`${date}: Archive source changed during collection. Existing data was not overwritten.`);
          } else await env.ARCHIVE.put(`d2:${date}`, JSON.stringify(record));
        }
        catch { errors.push(`${date}: Archive write failed. These numbers are available now but were not saved.`); }
      }
      records.set(date, record);
      collected.push(date);
    } catch (error) { errors.push(`${date}: ${safeError(error, env)}`); }
  }
  const paused = cooldown(source);
  if (paused) keepLastKnown(records, source, dates);
  return { collected, errors, status: errors.length ? 'degraded' : 'ok',
    ...(paused ? { cooldownUntil: paused.cooldownUntil, retryAfterSeconds: paused.retryAfterSeconds } : {}) };
}
function normalizeReferrer(raw) {
  const value = String(raw || '').trim();
  if (!value || value === '(none)') return '(direct)';
  let host;
  try { host = new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return value; }
  if ([SITE_HOST, 'lczmanim.cjaffa.com'].includes(host)) return '(same site)';
  return host || '(direct)';
}
function addRow(map, key, visits, views) {
  const previous = map.get(key) || { key, visits: 0, views: 0 };
  map.set(key, { key, visits: previous.visits + visits, views: previous.views + views });
}
function shapeWindow(records, range) {
  const since = Date.parse(range.since);
  const until = Date.parse(range.until);
  const dayMap = new Map(range.dates.map((date) => [date, { date, visits: 0, views: 0, knownHours: 0, coveredHours: 0, expectedHours: 0 }]));
  const localDays = [...dayMap.values()];
  const dayEnds = range.dates.map((date) => midnight(shiftDate(date, 1)));
  let dayIndex = 0;
  const dimMaps = Object.fromEntries(Object.keys(RECORD_KEYS).map((key) => [key, new Map()]));
  const dimMissing = Object.fromEntries(Object.keys(RECORD_KEYS).map((key) => [key, new Set()]));
  const dimErrors = Object.fromEntries(Object.keys(RECORD_KEYS).map((key) => [key, new Set()]));
  const missingTotals = Object.fromEntries(Object.keys(RECORD_KEYS).map((key) => [key, { views: 0, visits: 0 }]));
  const hours = [];
  let oldestCollectedAt = null;
  let newestCollectedAt = null;
  for (let instant = since; instant < until; instant += HOUR) {
    const date = isoDate(instant);
    while (dayIndex < localDays.length - 1 && instant >= dayEnds[dayIndex]) dayIndex += 1;
    const day = localDays[dayIndex];
    const localDate = day.date;
    const end = Math.min(instant + HOUR, until);
    day.expectedHours += 1;
    const record = records.get(date);
    if (!recordUsable(record) || recordUntil(record, date) <= instant) continue;
    // The old collector did not retain enough metadata to certify an empty
    // hour as a measured zero. Keep nonzero historical counts visibly partial.
    const legacy = record.version !== 2;
    const recordEnd = recordUntil(record, date);
    // A full hourly aggregate cannot be split at a historical minute. The read
    // path obtains a matching partial snapshot; otherwise this hour is missing.
    if (recordEnd > end && end < instant + HOUR) continue;
    const hour = new Date(instant).getUTCHours();
    const visits = record.v[hour];
    const views = record.w[hour];
    if (legacy && !visits && !views) continue;
    const complete = !legacy && recordEnd >= end;
    day.knownHours += 1;
    if (complete) day.coveredHours += 1;
    day.visits += visits;
    day.views += views;
    hours.push({ key: new Date(instant).toISOString(), visits, views, status: complete ? 'complete' : 'partial' });
    if (record.at) {
      if (!oldestCollectedAt || record.at < oldestCollectedAt) oldestCollectedAt = record.at;
      if (!newestCollectedAt || record.at > newestCollectedAt) newestCollectedAt = record.at;
    }
    for (const [name, key] of Object.entries(RECORD_KEYS)) {
      if (record.errors?.[name]) {
        dimErrors[name].add(record.errors[name]);
        dimMissing[name].add(localDate);
        missingTotals[name].views += views;
        missingTotals[name].visits += visits;
        continue;
      }
      if (record.version !== 2 || !Array.isArray(record[key]) || !record[key][hour]) {
        dimMissing[name].add(localDate);
        missingTotals[name].views += views;
        missingTotals[name].visits += visits;
        continue;
      }
      const entries = Object.entries(record[key][hour]);
      if (entries.some(([, pair]) => !Array.isArray(pair) || pair.length !== 2 || !pair.every(nonnegative))) {
        dimMissing[name].add(localDate);
        missingTotals[name].views += views;
        missingTotals[name].visits += visits;
        continue;
      }
      for (const [rawKey, pair] of entries) {
        addRow(dimMaps[name], name === 'referer' ? normalizeReferrer(rawKey) : rawKey, pair[0], pair[1]);
      }
    }
  }
  const byDay = [...dayMap.values()].map((day) => ({ ...day,
    status: !day.knownHours ? 'unavailable' : day.coveredHours < day.expectedHours ? 'partial' : 'complete',
    visits: day.knownHours ? day.visits : null, views: day.knownHours ? day.views : null,
  }));
  const knownHours = sum(byDay, 'knownHours');
  const coveredHours = sum(byDay, 'coveredHours');
  const expectedHours = sum(byDay, 'expectedHours');
  const totals = knownHours ? { visits: sum(hours, 'visits'), views: sum(hours, 'views') } : { visits: null, views: null };
  const status = !knownHours ? 'unavailable' : coveredHours < expectedHours ? 'partial' : 'complete';
  const groups = {};
  for (const [name, map] of Object.entries(dimMaps)) {
    const rows = [...map.values()].sort((a, b) => b.views - a.views || a.key.localeCompare(b.key));
    const totalViews = sum(rows, 'views');
    const totalVisits = sum(rows, 'visits');
    const differenceViews = totals.views === null ? null : totals.views - totalViews;
    const differenceVisits = totals.visits === null ? null : totals.visits - totalVisits;
    const unattributedViews = totals.views === null ? null : missingTotals[name].views;
    const unattributedVisits = totals.visits === null ? null : missingTotals[name].visits;
    const reconciliationDeltaViews = differenceViews === null ? null : differenceViews - unattributedViews;
    const reconciliationDeltaVisits = differenceVisits === null ? null : differenceVisits - unattributedVisits;
    const missingDates = [...dimMissing[name]];
    const mismatch = reconciliationDeltaViews !== 0 || reconciliationDeltaVisits !== 0;
    const groupStatus = !knownHours || (!rows.length && missingDates.length) ? 'unavailable'
      : missingDates.length || status !== 'complete' || mismatch ? 'partial' : 'complete';
    let message = '';
    if (!knownHours) message = 'No recorded hours are available for these dates.';
    else if (dimErrors[name].size) message = `This breakdown could not be collected: ${[...dimErrors[name]].join('; ')}`;
    else if (missingDates.length) message = 'Some archived hours have totals but no matching category detail. Older whole-day breakdowns are not mixed into this window.';
    else if (mismatch) message = 'Cloudflare returned a different total for this grouping. Sampling or collection delay can cause differences; the reported counts have not been adjusted.';
    else if (status !== 'complete') message = 'This breakdown covers only the recorded hours shown in the total.';
    groups[name] = { rows, status: groupStatus, totalViews, totalVisits, differenceViews, differenceVisits,
      unattributedViews, unattributedVisits, reconciliationDeltaViews, reconciliationDeltaVisits, missingDates, message };
  }
  groups.hour = { rows: hours, status, totalViews: totals.views, totalVisits: totals.visits,
    unattributedViews: 0, unattributedVisits: 0, message: status === 'complete' ? '' : 'Only recorded hours are included.' };
  groups.day = { rows: byDay.filter((day) => day.views !== null).map((day) => ({ key: day.date, views: day.views, visits: day.visits })), status };
  return {
    totals, byDay, byPage: groups.page.rows.map((row) => ({ path: row.key, views: row.views, visits: row.visits })), groups,
    coverage: { status, knownHours, coveredHours, expectedHours,
      knownDays: byDay.filter((day) => day.knownHours).length, completeDays: byDay.filter((day) => day.status === 'complete').length,
      expectedDays: byDay.length, missingDates: byDay.filter((day) => day.status !== 'complete').map((day) => day.date),
      detailStatus: Object.values(groups).every((group) => group.status === 'complete') ? 'complete' : 'partial',
      oldestCollectedAt, newestCollectedAt },
  };
}
async function report(env, range, source, budget) {
  const wanted = datesBetween(isoDate(range.since), isoDate(Date.parse(range.until) - 1));
  let records;
  let conflicts = [];
  let archive = env.ARCHIVE ? 'on' : 'off';
  const errors = [];
  try {
    const stored = await readRecords(env, wanted, source);
    records = stored.records;
    conflicts = stored.conflicts;
    if (conflicts.length) errors.push(`Archive source conflict for ${conflicts.join(', ')}. These records belong to another or an unidentified analytics source and were not included or overwritten.`);
    if (stored.ignoredLegacy.length) errors.push('Older archive records belong to the original analytics source and were not included for this source.');
  }
  catch { records = new Map(); archive = 'unreadable'; errors.push('Archive read failed. Only freshly collected data can be shown.'); }
  const nowDate = isoDate(Date.now());
  const oldest = shiftDate(nowDate, 1 - repairDays(env));
  const recent = wanted.filter((date) => date >= oldest && date <= nowDate && !conflicts.includes(date));
  const needed = collectionOrder(records, recent, range.snapshotAt);
  // A live request has a finite cost. The UI distinguishes these uncollected
  // dates from days on which a successful query returned zero events.
  let collection;
  if (archive !== 'on') {
    const live = await gatherLiveWindow(env, source, range, oldest, budget);
    records = live.records;
    collection = live.collection;
  } else {
    collection = await collectDates(env, records, needed.slice(0, READ_REPAIR_DAYS), range.snapshotAt, source, budget);
    collection.remainingDays = Math.max(0, needed.length - collection.collected.length);
  }
  collection.errors.unshift(...errors);
  collection.status = collection.errors.length ? 'degraded' : 'ok';
  const shaped = shapeWindow(records, range);
  const groupErrors = Object.values(shaped.groups).some((group) => group.status !== 'complete');
  return {
    schemaVersion: 2, build: BUILD, timezone: TIMEZONE, window: 'exact',
    range: { start: range.start, end: range.end, since: range.since, until: range.until },
    days: range.dates.length, since: range.since, until: range.until, snapshotAt: range.snapshotAt, snapshotAdjusted: range.snapshotAdjusted,
    ...shaped, archive, collection, source: sourceIdentity(source),
    site: source.site, narrowedBy: source.narrowedBy, dims: Object.fromEntries(settledDimensions),
    sync: { lookbackDays: repairDays(env), maxDaysPerRead: READ_REPAIR_DAYS,
      maxCollectionRequests: MAX_COLLECTION_REQUESTS, upstreamRequests: budget.upstreamRequests, cacheRequests: budget.cacheRequests },
    metrics: { visits: 'Cloudflare visits are arrivals, not unique people.',
      views: 'Page views recorded by the Cloudflare browser beacon.',
      sampling: 'Cloudflare may sample analytics. Independent groupings can differ and are not normalized.' },
    fetchedAt: new Date().toISOString(),
    cacheable: !collection.errors.length && shaped.coverage.status === 'complete' && !groupErrors,
  };
}

export default {
  async fetch(request, env, ctx) {
    const origin = allowedOrigin(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'GET') return json({ error: 'GET only' }, 405, origin);
    if (!origin) return json({ error: 'Not a caller this Worker answers.' }, 403, origin);
    if (!env.CF_API_TOKEN) return json({ error: 'CF_API_TOKEN is not configured on the analytics Worker.' }, 500, origin);
    const url = new URL(request.url);
    let range;
    try { range = requestedRange(url.searchParams); }
    catch (error) { return json({ error: safeError(error, env) }, 400, origin); }
    const cache = globalThis.caches?.default;
    try {
      const budget = { remaining: MAX_COLLECTION_REQUESTS, upstreamRequests: 0, cacheRequests: 0 };
      const source = await sourceFor(env, budget);
      const key = new Request(`${url.origin}/traffic?v=${BUILD}&account=${encodeURIComponent(source.account)}&filter=${source.narrowedBy}&site=${encodeURIComponent(source.site)}&start=${range.start}&end=${range.end}&asOf=${encodeURIComponent(range.snapshotAt)}`);
      const hit = cache && await cache.match(key);
      if (hit) return json({ ...await hit.json(), cached: true }, 200, origin, true);
      const out = await report(env, range, source, budget);
      const cacheable = out.cacheable;
      delete out.cacheable;
      const reply = json(out, 200, origin, cacheable);
      if (cacheable && cache) ctx.waitUntil(cache.put(key, reply.clone()));
      return reply;
    } catch (error) { return json({ error: safeError(error, env), schemaVersion: 2 }, 502, origin); }
  },
  async scheduled(event, env, ctx) {
    if (!env.ARCHIVE || !env.CF_API_TOKEN) return;
    const at = event.scheduledTime || Date.now();
    const hour = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).format(new Date(at));
    if (hour !== '00') return;
    ctx.waitUntil((async () => {
      const budget = { remaining: MAX_COLLECTION_REQUESTS, upstreamRequests: 0, cacheRequests: 0 };
      const yesterday = shiftDate(isoDate(at), -1);
      const dates = datesBetween(shiftDate(yesterday, 1 - repairDays(env)), yesterday);
      const source = await sourceFor(env, budget);
      const stored = await readRecords(env, dates, source);
      const records = stored.records;
      const safeDates = dates.filter((date) => !stored.conflicts.includes(date));
      const forced = safeDates.filter((date) => date >= shiftDate(yesterday, 1 - CRON_REFRESH_DAYS)).reverse();
      const todo = collectionOrder(records, safeDates, new Date(at).toISOString(), forced).slice(0, READ_REPAIR_DAYS);
      const result = await collectDates(env, records, todo, new Date(at).toISOString(), source, budget);
      if (stored.conflicts.length) result.errors.push(`Archive source conflicts were not overwritten: ${stored.conflicts.join(', ')}.`);
      if (result.errors.length) throw new Error(result.errors.join('; '));
    })());
  },
};
